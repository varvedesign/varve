/**
 * Hostile and malformed input, as an attacker or a confused model would send it.
 *
 * Each case states what must not happen (a change, a privilege, a polluted
 * prototype, a crash), not just that an error appears.
 */
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createStandardCatalog } from '../commands';
import { CONTROL_PROTOCOL, ControlConnection } from '../control';
import { Executor } from '../executor';
import { HeadlessAuthority } from '../headless';
import { makeSession, principal } from './harness';

const RECT = { kind: 'rect', x: 0, y: 0, width: 10, height: 10 };

describe('command names are matched exactly', () => {
  const variants = [
    'VARVE.NODE.CREATE',
    'Varve.Node.Create',
    ' varve.node.create',
    'varve.node.create ',
    'varve.node.create\u0000',
    'varve.node.create​',
    'varve.node.creatе', // Cyrillic e
    'ｖarve.node.create', // fullwidth v
    'varve.node.create/../delete',
    'varve.node.cre',
    'varve.node',
    '',
  ];

  it.each(variants)('does not run %j as a command', async (name) => {
    const s = makeSession();
    const before = JSON.stringify(s.doc());
    const r = await s.run(name, RECT);
    expect(r.outcome).toBe('rejected');
    expect(['UNKNOWN_COMMAND', 'INVALID_ARGUMENT']).toContain(r.error?.code);
    expect(JSON.stringify(s.doc())).toBe(before);
    expect(s.authority.getRevision()).toBe(0);
  });
});

describe('a batch is not a way around the grants', () => {
  const editor = principal('editor', ['read', 'edit']);

  it('an atomic batch with one step above the grants applies nothing, including the permitted steps', async () => {
    const s = makeSession();
    const r = await s.executor.executeBatch(s.as(editor), {
      mode: 'atomic',
      steps: [
        { command: 'varve.node.create', args: RECT },
        { command: 'varve.document.save', args: {} },
      ],
    });
    expect(r.outcome).toBe('rejected');
    expect(s.authority.getRevision()).toBe(0);
  });

  it('even a partial batch is refused whole when any step is above the grants, before anything runs', async () => {
    const s = makeSession();
    const r = await s.executor.executeBatch(s.as(editor), {
      mode: 'partial',
      onError: 'continue',
      steps: [
        { command: 'varve.node.create', args: RECT },
        { command: 'varve.document.save', args: {} },
      ],
    });
    // The permitted first step does not slip through ahead of the refused one.
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(r.error?.details).toMatchObject({ step: 1, required: 'export' });
    expect(r.steps).toHaveLength(0);
    expect(s.authority.getRevision()).toBe(0);
  });

  it('a read-only principal cannot mutate through any step of a batch', async () => {
    const s = makeSession();
    const reader = principal('reader', ['read']);
    const r = await s.executor.executeBatch(s.as(reader), {
      mode: 'atomic',
      steps: [
        { command: 'varve.document.info', args: {} },
        { command: 'varve.node.create', args: RECT },
      ],
    });
    expect(r.outcome).toBe('rejected');
    expect(s.authority.getRevision()).toBe(0);
  });

  it('a principal with no grants can do nothing, not even read', async () => {
    const s = makeSession();
    const nobody = principal('nobody', []);
    const info = await s.executor.execute(s.as(nobody), {
      command: 'varve.document.info',
      args: {},
    });
    expect(info.error?.code).toBe('PERMISSION_DENIED');
  });
});

describe('$ref reaches earlier results and nothing else', () => {
  const prototypeAttempts = [
    'alias#/__proto__',
    'alias#/constructor',
    'alias#/toString',
    'alias#/created/constructor',
  ];

  it.each(prototypeAttempts)('refuses %s and pollutes nothing', async (ref) => {
    const s = makeSession();
    const r = await s.executor.executeBatch(s.ctx, {
      mode: 'atomic',
      steps: [
        { command: 'varve.node.create', args: RECT, alias: 'alias' },
        { command: 'varve.node.set', args: { nodeIds: [{ $ref: ref }], opacity: 0.5 } },
      ],
    });
    expect(r.outcome).toBe('rejected');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('refuses a reference to a step that has not run yet, and to one that does not exist', async () => {
    const s = makeSession();
    const forward = await s.executor.executeBatch(s.ctx, {
      mode: 'atomic',
      steps: [
        {
          command: 'varve.node.set',
          args: { nodeIds: [{ $ref: 'later#/created/0' }], opacity: 0.5 },
        },
        { command: 'varve.node.create', args: RECT, alias: 'later' },
      ],
    });
    expect(forward.outcome).toBe('rejected');
    const missing = await s.executor.executeBatch(s.ctx, {
      mode: 'atomic',
      steps: [
        { command: 'varve.node.set', args: { nodeIds: [{ $ref: 'nope#/created/0' }], opacity: 1 } },
      ],
    });
    expect(missing.outcome).toBe('rejected');
    expect(s.authority.getRevision()).toBe(0);
  });

  it('refuses a reference that resolves to an object, which would smuggle structure into arguments', async () => {
    const s = makeSession();
    const r = await s.executor.executeBatch(s.ctx, {
      mode: 'atomic',
      steps: [
        { command: 'varve.node.create', args: RECT, alias: 'a' },
        { command: 'varve.node.set', args: { nodeIds: [{ $ref: 'a#/idMap' }], opacity: 1 } },
      ],
    });
    expect(r.outcome).toBe('rejected');
  });

  it('a $ref with extra keys is not a reference and is not partly honored', async () => {
    const s = makeSession();
    const r = await s.executor.executeBatch(s.ctx, {
      mode: 'atomic',
      steps: [
        { command: 'varve.node.create', args: RECT, alias: 'a' },
        {
          command: 'varve.node.set',
          args: { nodeIds: [{ $ref: 'a#/created/0', extra: 1 }], opacity: 1 },
        },
      ],
    });
    expect(r.outcome).toBe('rejected');
  });
});

describe('numbers are numbers', () => {
  const notNumbers: unknown[] = [
    'NaN',
    'Infinity',
    '-Infinity',
    '10',
    '10px',
    '1e3',
    ' 5 ',
    '0x10',
    null,
    true,
    [],
    [5],
    {},
    { valueOf: 5 },
  ];

  it.each(notNumbers.map((v) => [JSON.stringify(v), v]))(
    'rejects %s for a coordinate and a size',
    async (_label, value) => {
      for (const field of ['x', 'width'] as const) {
        const s = makeSession();
        const r = await s.run('varve.node.create', { ...RECT, [field]: value });
        expect(r.outcome, `${field}=${_label}`).toBe('rejected');
        expect(r.error?.code).toBe('INVALID_ARGUMENT');
        expect(s.authority.getRevision()).toBe(0);
      }
    },
  );

  it('rejects magnitudes that would overflow downstream arithmetic', async () => {
    for (const value of [1e308, -1e308, 1e12, Number.MAX_SAFE_INTEGER]) {
      const s = makeSession();
      const r = await s.run('varve.node.create', { ...RECT, x: value });
      expect(r.outcome, String(value)).toBe('rejected');
    }
  });
});

describe('a frame cannot carry what the strict parser forbids', () => {
  function connection() {
    const authority = new HeadlessAuthority({
      document: createDocument('Hostile'),
      instanceId: 'h',
    });
    const conn = new ControlConnection({
      executor: new Executor({ catalog: createStandardCatalog() }),
      authority,
      authenticate: (credential) => (credential === 'ok' ? principal('c', ['read', 'edit']) : null),
      serverInfo: { name: 't', version: '0' },
    });
    const send = async (line: string) => {
      const out = await conn.handleLine(line);
      return out === null ? null : (JSON.parse(out) as Record<string, any>);
    };
    return { conn, authority, send };
  }
  const hello =
    '{"jsonrpc":"2.0","id":0,"method":"session.hello","params":{"credential":"ok","client":{"name":"x","version":"1"},"protocolVersions":["' +
    CONTROL_PROTOCOL +
    '"]}}';

  it('rejects a __proto__ key anywhere in a request and leaves Object.prototype alone', async () => {
    const c = connection();
    await c.send(hello);
    const r = await c.send(
      '{"jsonrpc":"2.0","id":1,"method":"command.execute","params":{"command":"varve.node.create","args":{"kind":"rect","x":0,"y":0,"width":1,"height":1,"__proto__":{"polluted":true}}}}',
    );
    expect(r?.error ?? r?.result?.error).toBeTruthy();
    expect(c.authority.getRevision()).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('survives a hundred thousand levels of nesting without crashing, and changes nothing', async () => {
    const c = connection();
    await c.send(hello);
    const deep = '['.repeat(100_000) + ']'.repeat(100_000);
    const r = await c.send(
      `{"jsonrpc":"2.0","id":1,"method":"command.execute","params":{"command":"varve.node.create","args":${deep}}}`,
    );
    expect(r).not.toBeNull();
    expect(c.authority.getRevision()).toBe(0);
    // And the connection still works afterwards.
    const ok = await c.send(
      '{"jsonrpc":"2.0","id":2,"method":"command.execute","params":{"command":"varve.document.info","args":{}}}',
    );
    expect(ok?.result?.outcome).toBe('ok');
  });

  it('does not let a request assert who it is: principal, grants and origin are unknown keys', async () => {
    const c = connection();
    await c.send(hello);
    for (const extra of [
      '"principal":{"id":"root","grants":["edit","export","external"]}',
      '"grants":["external"]',
      '"origin":"ui"',
      '"actorId":"someone-else"',
    ]) {
      const r = await c.send(
        `{"jsonrpc":"2.0","id":9,"method":"command.execute","params":{"command":"varve.node.create","args":{"kind":"rect","x":0,"y":0,"width":1,"height":1},${extra}}}`,
      );
      expect(r?.result?.outcome ?? 'error', extra).not.toBe('applied');
      expect(c.authority.getRevision(), extra).toBe(0);
    }
  });

  it('refuses a number that overflows to infinity inside a frame', async () => {
    const c = connection();
    await c.send(hello);
    const r = await c.send(
      '{"jsonrpc":"2.0","id":1,"method":"command.execute","params":{"command":"varve.node.create","args":{"kind":"rect","x":1e999,"y":0,"width":1,"height":1}}}',
    );
    expect(r?.error ?? r?.result?.error).toBeTruthy();
    expect(c.authority.getRevision()).toBe(0);
  });
});
