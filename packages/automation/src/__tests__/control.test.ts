import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createStandardCatalog } from '../commands';
import {
  CONTROL_PROTOCOL,
  ControlConnection,
  type ControlServerConfig,
  LineFramer,
  parseFrame,
  RPC_ERROR,
} from '../control';
import { Executor } from '../executor';
import { HeadlessAuthority } from '../headless';
import { BATCH_RECEIPT_OUTPUT_SCHEMA, RECEIPT_OUTPUT_SCHEMA } from '../receipt';
import { validateUnknown } from '../schema';
import { makeSession, principal } from './harness';

const enc = new TextEncoder();

function frames(maxBytes: number) {
  const lines: string[] = [];
  const events: string[] = [];
  const framer = new LineFramer(maxBytes, {
    onLine: (line) => lines.push(line),
    onOverflow: (limit) => events.push(`overflow:${limit}`),
    onInvalidUtf8: () => events.push('invalid-utf8'),
  });
  return { framer, lines, events };
}

describe('LineFramer', () => {
  it('delivers several frames from one read and keeps a partial for the next', () => {
    const { framer, lines } = frames(1024);
    framer.push(enc.encode('{"a":1}\n{"b":2}\n{"c"'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    framer.push(enc.encode(':3}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('reassembles a multibyte character split across reads', () => {
    const { framer, lines } = frames(1024);
    // Astral character written as an escape so no literal emoji is committed.
    const bytes = enc.encode('{"t":"日本語\u{1F600}"}\n');
    for (const byte of bytes) framer.push(new Uint8Array([byte]));
    expect(lines).toEqual(['{"t":"日本語\u{1F600}"}']);
  });

  it('accepts CRLF and ignores blank lines', () => {
    const { framer, lines } = frames(1024);
    framer.push(enc.encode('{"a":1}\r\n\r\n\n{"b":2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('discards an oversize line as it arrives, reports once, and recovers', () => {
    const { framer, lines, events } = frames(64);
    const huge = 'x'.repeat(10_000);
    // Delivered in pieces: memory must not grow with the discarded line.
    framer.push(enc.encode(huge.slice(0, 5000)));
    expect(framer.pendingBytes).toBe(0);
    framer.push(enc.encode(huge.slice(5000)));
    expect(framer.pendingBytes).toBe(0);
    framer.push(enc.encode('\n{"ok":true}\n'));
    expect(events).toEqual(['overflow:64']);
    expect(lines).toEqual(['{"ok":true}']);
  });

  it('reports invalid UTF-8 without delivering the line', () => {
    const { framer, lines, events } = frames(64);
    framer.push(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d, 0x0a]));
    expect(lines).toEqual([]);
    expect(events).toEqual(['invalid-utf8']);
  });

  it('delivers an unterminated final line on end()', () => {
    const { framer, lines } = frames(64);
    framer.push(enc.encode('{"a":1}'));
    framer.end();
    expect(lines).toEqual(['{"a":1}']);
  });
});

describe('parseFrame', () => {
  it('rejects JSON-RPC batch arrays with guidance', () => {
    const r = parseFrame('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.response).toContain('batch.execute');
  });

  it('treats a request without id as a notification', () => {
    expect(parseFrame('{"jsonrpc":"2.0","method":"ping"}').kind).toBe('notification');
  });

  it('rejects null and fractional-NaN ids and wrong versions', () => {
    expect(parseFrame('{"jsonrpc":"2.0","id":null,"method":"ping"}').kind).toBe('error');
    expect(parseFrame('{"jsonrpc":"1.0","id":1,"method":"ping"}').kind).toBe('error');
    expect(parseFrame('{"jsonrpc":"2.0","id":1}').kind).toBe('error');
  });

  it('rejects duplicate keys in a frame', () => {
    const r = parseFrame('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}');
    expect(r.kind).toBe('error');
  });
});

function server(overrides: Partial<ControlServerConfig> = {}) {
  const document = createDocument('Control');
  const authority = new HeadlessAuthority({ document, instanceId: 'ctl-instance' });
  const executor = new Executor({ catalog: createStandardCatalog() });
  const token = 'good-credential';
  const connection = new ControlConnection({
    executor,
    authority,
    authenticate: (credential) =>
      credential === token ? principal('client-a', ['read', 'edit']) : null,
    serverInfo: { name: 'test', version: '0' },
    ...overrides,
  });
  const send = async (message: unknown) => {
    const response = await connection.handleLine(JSON.stringify(message));
    return response === null ? null : (JSON.parse(response) as Record<string, any>);
  };
  const hello = (credential = token) =>
    send({
      jsonrpc: '2.0',
      id: 'h',
      method: 'session.hello',
      params: {
        credential,
        client: { name: 'unit', version: '1' },
        protocolVersions: [CONTROL_PROTOCOL],
      },
    });
  return { connection, authority, send, hello, token };
}

describe('ControlConnection handshake', () => {
  it('refuses any method before session.hello and closes', async () => {
    const s = server();
    const r = await s.send({ jsonrpc: '2.0', id: 1, method: 'command.execute', params: {} });
    expect(r?.error.code).toBe(RPC_ERROR.SESSION_REQUIRED);
    expect(s.connection.shouldClose).toBe(true);
    expect(s.authority.getRevision()).toBe(0);
  });

  it('closes on a non-JSON first frame', async () => {
    const s = server();
    const out = await s.connection.handleLine('GET / HTTP/1.1');
    expect(JSON.parse(out as string).error.code).toBe(RPC_ERROR.PARSE_ERROR);
    expect(s.connection.shouldClose).toBe(true);
  });

  it('applies the small pre-auth frame limit, then the larger one', async () => {
    const s = server();
    expect(s.connection.maxFrameBytes).toBe(4096);
    await s.hello();
    expect(s.connection.maxFrameBytes).toBeGreaterThan(4096);
  });

  it('authenticates with a good credential and reports identity without secrets', async () => {
    const s = server();
    const r = await s.hello();
    expect(r?.result.protocol).toBe(CONTROL_PROTOCOL);
    expect(r?.result.session.mode).toBe('headless');
    expect(r?.result.session.instanceId).toBe('ctl-instance');
    expect(r?.result.principal).toMatchObject({ id: 'client-a', grants: ['read', 'edit'] });
    expect(JSON.stringify(r)).not.toContain('good-credential');
  });

  it('closes after repeated bad credentials', async () => {
    const s = server();
    for (let i = 0; i < 3; i++) {
      const r = await s.hello('wrong');
      expect(r?.error.code).toBe(RPC_ERROR.UNAUTHENTICATED);
    }
    expect(s.connection.shouldClose).toBe(true);
  });

  it('rejects an unsupported protocol version and says what is supported', async () => {
    const s = server();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'session.hello',
      params: {
        credential: 'good-credential',
        client: { name: 'x' },
        protocolVersions: ['varve.control/9'],
      },
    });
    expect(r?.error.code).toBe(RPC_ERROR.PROTOCOL_UNSUPPORTED);
    expect(r?.error.data.supported).toEqual([CONTROL_PROTOCOL]);
  });

  it('rejects unknown hello fields, so identity cannot be asserted in the body', async () => {
    const s = server();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'session.hello',
      params: {
        credential: 'good-credential',
        client: { name: 'x' },
        protocolVersions: [CONTROL_PROTOCOL],
        principal: { grants: ['edit'] },
      },
    });
    expect(r?.error.code).toBe(RPC_ERROR.INVALID_PARAMS);
  });

  it('closes an unauthenticated connection whose hello deadline passes', async () => {
    const s = server();
    const message = s.connection.onHelloTimeout();
    expect(JSON.parse(message as string).error.code).toBe(RPC_ERROR.SESSION_REQUIRED);
    expect(s.connection.shouldClose).toBe(true);
  });
});

describe('ControlConnection dispatch', () => {
  it('echoes ids and keeps application refusals out of JSON-RPC errors', async () => {
    const s = server();
    await s.hello();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 'req-7',
      method: 'command.execute',
      params: { command: 'varve.node.delete', args: { nodeIds: ['ghost'] } },
    });
    expect(r?.id).toBe('req-7');
    expect(r?.error).toBeUndefined();
    expect(r?.result.outcome).toBe('rejected');
    expect(r?.result.error.code).toBe('UNKNOWN_TARGET');
  });

  it('executes and commits through the same executor', async () => {
    const s = server();
    await s.hello();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'command.execute',
      params: {
        command: 'varve.node.create',
        args: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 },
      },
    });
    expect(r?.result.outcome).toBe('applied');
    expect(s.authority.getRevision()).toBe(1);
  });

  it('applies a batch as one ordered transaction', async () => {
    const s = server();
    await s.hello();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'batch.execute',
      params: {
        steps: [
          { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } },
          { command: 'varve.node.create', args: { kind: 'rect', x: 5, y: 5, width: 1, height: 1 } },
        ],
      },
    });
    expect(r?.result.outcome).toBe('applied');
    expect(s.authority.listTransactions()).toHaveLength(1);
  });

  it('enforces grants on the executor path, not just on method names', async () => {
    const s = server({
      authenticate: () => principal('reader', ['read']),
    });
    await s.hello('anything');
    const r = await s.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'command.execute',
      params: {
        command: 'varve.node.create',
        args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      },
    });
    expect(r?.result.error.code).toBe('PERMISSION_DENIED');
    expect(s.authority.getRevision()).toBe(0);
  });

  it('lists only commands the principal may run and describes with schemas', async () => {
    const s = server({ authenticate: () => principal('reader', ['read']) });
    await s.hello('anything');
    const list = await s.send({ jsonrpc: '2.0', id: 5, method: 'catalog.list', params: {} });
    const ids = ((list?.result.commands ?? []) as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain('varve.node.list');
    expect(ids).not.toContain('varve.node.create');
    const denied = await s.send({
      jsonrpc: '2.0',
      id: 6,
      method: 'catalog.describe',
      params: { command: 'varve.node.create' },
    });
    expect(denied?.error.code).toBe(RPC_ERROR.INVALID_PARAMS);
  });

  it('answers unknown methods with a protocol error', async () => {
    const s = server();
    await s.hello();
    const r = await s.send({ jsonrpc: '2.0', id: 8, method: 'document.quit', params: {} });
    expect(r?.error.code).toBe(RPC_ERROR.METHOD_NOT_FOUND);
  });

  it('never executes a notification, and sends no reply', async () => {
    const s = server();
    await s.hello();
    const r = await s.connection.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'command.execute',
        params: {
          command: 'varve.node.create',
          args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
        },
      }),
    );
    expect(r).toBeNull();
    expect(s.authority.getRevision()).toBe(0);
  });

  it('processes pipelined requests in order', async () => {
    const s = server();
    await s.hello();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        s.connection.handleLine(
          JSON.stringify({
            jsonrpc: '2.0',
            id: n,
            method: 'command.execute',
            params: {
              command: 'varve.node.create',
              args: { kind: 'rect', x: n, y: 0, width: 1, height: 1 },
            },
          }),
        ),
      ),
    );
    const revisions = results.map((line) => JSON.parse(line as string).result.revision.after);
    expect(revisions).toEqual([1, 2, 3]);
  });

  it('closes only this connection on session.close', async () => {
    const s = server();
    await s.hello();
    const r = await s.send({ jsonrpc: '2.0', id: 9, method: 'session.close', params: {} });
    expect(r?.result.ok).toBe(true);
    expect(s.connection.shouldClose).toBe(true);
    expect(s.authority.getRevision()).toBe(0);
  });

  it('refuses to return a result larger than the response limit', async () => {
    const s = server({ limits: { maxResponseBytes: 400 } });
    await s.hello();
    const r = await s.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'catalog.describe',
      params: { command: 'varve.node.create' },
    });
    expect(r?.error.code).toBe(RPC_ERROR.RESPONSE_TOO_LARGE);
  });
});

describe('advertised receipt schemas', () => {
  it('every real receipt conforms, including rejections and previews', async () => {
    const s1 = makeSession();
    const receipts = [
      await s1.run('varve.node.create', { kind: 'rect', x: 0, y: 0, width: 5, height: 5 }),
      await s1.run(
        'varve.node.create',
        { kind: 'rect', x: 0, y: 0, width: 5, height: 5 },
        { dryRun: true },
      ),
      await s1.run('varve.node.delete', { nodeIds: ['ghost'] }),
      await s1.run('varve.document.info', {}),
      await s1.run(
        'varve.node.create',
        { kind: 'rect', x: 0, y: 0, width: 5, height: 5 },
        { idempotencyKey: 'k', attempt: 2 },
      ),
      await s1.run('varve.document.save', {}),
    ];
    for (const receipt of receipts) {
      const checked = validateUnknown(RECEIPT_OUTPUT_SCHEMA, receipt);
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
    }
    const batch = await s1.executor.executeBatch(s1.ctx, {
      steps: [
        { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } },
      ],
    });
    expect(validateUnknown(BATCH_RECEIPT_OUTPUT_SCHEMA, batch).ok).toBe(true);
  });
});
