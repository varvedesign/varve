/**
 * Cross-client tests for the control channel and the MCP server.
 *
 * Every server here is a separate process built from the packaged bundle. The
 * clients are deliberately of different lineage so one parser cannot agree
 * with its own bug: a hand-written raw NDJSON client (no SDK), the v1 SDK
 * client (initialize handshake), and the v2 SDK client (modern discover).
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as ClientV2 } from '@modelcontextprotocol/client';
import { StdioClientTransport as StdioV2 } from '@modelcontextprotocol/client/stdio';
import { Client as ClientV1 } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as StdioV1 } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDocument, DocumentCodec } from '@varve/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const buildScript = join(here, '../../scripts/build-bundle.mjs');

let root: string;
let bundle: string;
let runtimeDir: string;
const spawned: ChildProcessWithoutNullStreams[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vcm-'));
  runtimeDir = join(root, 'rt');
  mkdirSync(runtimeDir, { recursive: true });
  bundle = join(root, 'bin', 'varve.mjs');
  const built = spawnSync(process.execPath, [buildScript, '--outfile', bundle], {
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`bundle build failed: ${built.stderr}`);
}, 180_000);

afterAll(() => {
  for (const child of spawned) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(root, { recursive: true, force: true });
});

// ── helpers ─────────────────────────────────────────────────────────────────

class LineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: string[] = [];
  stderr = '';
  private buffer = '';
  private waiters: Array<() => void> = [];
  readonly exited: Promise<number | null>;

  constructor(args: string[], env: Record<string, string> = {}) {
    this.child = spawn(process.execPath, [bundle, ...args], {
      env: { PATH: '', VARVE_RUNTIME_DIR: runtimeDir, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    spawned.push(this.child);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf('\n');
      while (index >= 0) {
        this.lines.push(this.buffer.slice(0, index));
        this.buffer = this.buffer.slice(index + 1);
        index = this.buffer.indexOf('\n');
      }
      for (const wake of this.waiters.splice(0)) wake();
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    this.exited = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)));
  }

  send(message: unknown): void {
    this.child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  }

  async nextLineMatching(
    predicate: (parsed: Record<string, any>) => boolean,
    timeoutMs = 15_000,
  ): Promise<Record<string, any>> {
    const deadline = Date.now() + timeoutMs;
    let cursor = 0;
    for (;;) {
      while (cursor < this.lines.length) {
        const parsed = JSON.parse(this.lines[cursor++] as string) as Record<string, any>;
        if (predicate(parsed)) return parsed;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out; lines so far: ${this.lines.join(' | ')}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async request(
    message: { id: number | string } & Record<string, unknown>,
  ): Promise<Record<string, any>> {
    this.send(message);
    return this.nextLineMatching((parsed) => parsed.id === message.id);
  }

  end(): void {
    this.child.stdin.end();
  }
}

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'raw-client', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

let counter = 0;
function modern(method: string, params: Record<string, unknown> = {}) {
  counter += 1;
  return { jsonrpc: '2.0', id: counter, method, params: { ...params, _meta: META } };
}

function callTool(name: string, args: Record<string, unknown> = {}) {
  return modern('tools/call', { name, arguments: args });
}

let docCounter = 0;
function fixtureDoc(): string {
  docCounter += 1;
  const dir = join(root, `d${docCounter}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'doc.varve');
  writeFileSync(
    path,
    DocumentCodec.encode({ ...createDocument('Fixture', { flat: true }), id: 'fx' }),
  );
  return path;
}

const rect = { kind: 'rect', x: 1, y: 2, width: 30, height: 40 };

// ── MCP over stdio: modern protocol, raw client ─────────────────────────────

describe('MCP stdio, 2026-07-28, raw independent client', () => {
  it('serves server/discover with honest capabilities and instructions', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const reply = await mcp.request(modern('server/discover'));
    expect(reply.result.supportedVersions).toContain('2026-07-28');
    expect(reply.result.capabilities.tools).toBeDefined();
    expect(reply.result.capabilities.tools.listChanged).toBeFalsy();
    expect(reply.result.instructions).toContain('varve_session');
    mcp.end();
    expect(await mcp.exited).toBe(0);
  });

  it('lists a fixed, ordered tool set with honest annotations and closed schemas', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const first = await mcp.request(modern('tools/list'));
    const second = await mcp.request(modern('tools/list'));
    const names = (first.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b)).length === names.length ? names : names,
    );
    expect(new Set(names)).toEqual(
      new Set([
        'varve_batch',
        'varve_describe_command',
        'varve_invoke',
        'varve_query',
        'varve_search_commands',
        'varve_session',
      ]),
    );
    expect(second.result.tools.map((t: { name: string }) => t.name)).toEqual(names);

    const byName = Object.fromEntries(
      (first.result.tools as Array<Record<string, any>>).map((t) => [t.name, t]),
    );
    for (const readOnly of [
      'varve_session',
      'varve_search_commands',
      'varve_describe_command',
      'varve_query',
    ]) {
      expect(byName[readOnly].annotations.readOnlyHint, readOnly).toBe(true);
    }
    for (const writes of ['varve_invoke', 'varve_batch']) {
      expect(byName[writes].annotations.readOnlyHint, writes).toBe(false);
      expect(byName[writes].annotations.destructiveHint, writes).toBe(true);
    }
    for (const tool of first.result.tools as Array<{
      name: string;
      inputSchema: Record<string, unknown>;
    }>) {
      if (tool.inputSchema.type === 'object') {
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      }
    }
    mcp.end();
    await mcp.exited;
  });

  it('keeps stdout to protocol messages only and exits cleanly on stdin EOF', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    await mcp.request(callTool('varve_session'));
    mcp.end();
    expect(await mcp.exited).toBe(0);
    for (const line of mcp.lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
    expect(mcp.stderr).toContain('headless session');
  });

  it('reports the session, then applies an edit with a receipt and an idempotency key', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const session = await mcp.request(callTool('varve_session'));
    expect(session.result.isError).toBeFalsy();
    const info = session.result.structuredContent;
    expect(info.mode).toBe('headless');
    expect(info.notes.join(' ')).toContain('not the running application');

    const created = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.node.create',
        args: rect,
        idempotencyKey: 'mcp-1',
        target: { documentId: info.documentId, generation: info.generation },
        expectedRevision: 0,
      }),
    );
    expect(created.result.isError).toBeFalsy();
    expect(created.result.structuredContent.outcome).toBe('applied');
    expect(created.result.structuredContent.created).toHaveLength(1);
    expect(created.result.content[0].text).toContain('Create rect');

    // The same request with attempt 2 replays rather than editing twice.
    const retry = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.node.create',
        args: rect,
        idempotencyKey: 'mcp-1',
        attempt: 2,
      }),
    );
    expect(retry.result.structuredContent.idempotency.replayed).toBe(true);
    const list = await mcp.request(
      callTool('varve_query', { command: 'varve.node.list', args: { parentId: null } }),
    );
    expect(list.result.structuredContent.output.total).toBe(1);
    mcp.end();
    await mcp.exited;
  });

  it('returns refusals as tool errors with structured issues, not as protocol errors', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const reply = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.node.create',
        args: { ...rect, cornerRadious: 3 },
      }),
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).toBe(true);
    expect(reply.result.structuredContent.outcome).toBe('rejected');
    expect(reply.result.structuredContent.error.issues[0].path).toBe('/cornerRadious');
    mcp.end();
    await mcp.exited;
  });

  it('refuses to let the read-only query tool run a mutating command', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const reply = await mcp.request(
      callTool('varve_query', { command: 'varve.node.create', args: rect }),
    );
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain('varve_invoke');
    const info = await mcp.request(callTool('varve_query', { command: 'varve.document.info' }));
    expect(info.result.structuredContent.output.revision).toBe(0);
    mcp.end();
    await mcp.exited;
  });

  it('enforces the session grants: a read-only session cannot edit, and cannot see edit commands', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo']); // default grant is read only
    const denied = await mcp.request(
      callTool('varve_invoke', { command: 'varve.node.create', args: rect }),
    );
    expect(denied.result.isError).toBe(true);
    expect(denied.result.structuredContent.error.code).toBe('PERMISSION_DENIED');
    const search = await mcp.request(callTool('varve_search_commands', { query: 'create' }));
    const ids = (search.result.structuredContent.commands as Array<{ id: string }>).map(
      (c) => c.id,
    );
    expect(ids).not.toContain('varve.node.create');
    mcp.end();
    await mcp.exited;
  });

  it('reports a stale expectedRevision as a conflict without changing anything', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    await mcp.request(callTool('varve_invoke', { command: 'varve.node.create', args: rect }));
    const stale = await mcp.request(
      callTool('varve_invoke', { command: 'varve.node.create', args: rect, expectedRevision: 0 }),
    );
    expect(stale.result.structuredContent.error.code).toBe('REVISION_CONFLICT');
    expect(stale.result.structuredContent.error.retryable).toBe(true);
    mcp.end();
    await mcp.exited;
  });

  it('rejects an unsupported protocol version with the supported list', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo']);
    const reply = await mcp.request({
      jsonrpc: '2.0',
      id: 900,
      method: 'tools/list',
      params: {
        _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' },
      },
    });
    expect(reply.error.code).toBe(-32022);
    expect(reply.error.data.supported).toContain('2026-07-28');
    mcp.end();
    await mcp.exited;
  });

  it('describes a command with a JSON Schema and returns the batch tool receipt', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const described = await mcp.request(
      callTool('varve_describe_command', { command: 'varve.node.create' }),
    );
    expect(described.result.structuredContent.inputSchema.oneOf).toHaveLength(4);
    const batch = await mcp.request(
      callTool('varve_batch', {
        steps: [
          { command: 'varve.node.create', alias: 'a', args: rect },
          {
            command: 'varve.node.set',
            args: { nodeIds: [{ $ref: 'a#/created/0' }], opacity: 0.5 },
          },
        ],
      }),
    );
    expect(batch.result.structuredContent.outcome).toBe('applied');
    expect(batch.result.structuredContent.mode).toBe('atomic');
    mcp.end();
    await mcp.exited;
  });
});

describe('MCP stdio, saving and file policy', () => {
  it('saves only with the export permission and reports destination, size and hash', async () => {
    const dir = join(root, 'save1');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, 'result.varve');
    const withoutExport = new LineProcess([
      'mcp',
      '--new',
      'S',
      '--out',
      out,
      '--grant',
      'read,edit',
    ]);
    await withoutExport.request(
      callTool('varve_invoke', { command: 'varve.node.create', args: rect }),
    );
    const refused = await withoutExport.request(
      callTool('varve_invoke', { command: 'varve.document.save' }),
    );
    expect(refused.result.structuredContent.error.code).toBe('PERMISSION_DENIED');
    expect(existsSync(out)).toBe(false);
    withoutExport.end();
    await withoutExport.exited;

    const full = new LineProcess([
      'mcp',
      '--new',
      'S',
      '--out',
      out,
      '--grant',
      'read,edit,export',
    ]);
    await full.request(callTool('varve_invoke', { command: 'varve.node.create', args: rect }));
    const saved = await full.request(callTool('varve_invoke', { command: 'varve.document.save' }));
    const receipt = saved.result.structuredContent;
    expect(receipt.outcome).toBe('applied');
    expect(receipt.durable.saved).toBe(true);
    const bytes = readFileSync(out);
    expect(bytes.byteLength).toBe(receipt.durable.bytes);
    expect(DocumentCodec.decode(bytes.toString('utf8')).ok).toBe(true);
    full.end();
    await full.exited;
  });

  it('refuses a caller-chosen path when no write roots are configured', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'S', '--grant', 'read,edit,export']);
    const reply = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.document.save',
        args: { path: join(root, 'anywhere.varve') },
      }),
    );
    expect(reply.result.structuredContent.error.code).toBe('PERMISSION_DENIED');
    expect(existsSync(join(root, 'anywhere.varve'))).toBe(false);
    mcp.end();
    await mcp.exited;
  });

  it('confines a caller-chosen path to the write roots', async () => {
    const allowed = join(root, 'allowed-mcp');
    mkdirSync(allowed, { recursive: true });
    const mcp = new LineProcess([
      'mcp',
      '--new',
      'S',
      '--grant',
      'read,edit,export',
      '--write-root',
      allowed,
    ]);
    const inside = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.document.save',
        args: { path: join(allowed, 'ok.varve') },
      }),
    );
    expect(inside.result.structuredContent.outcome).toBe('applied');
    const outside = await mcp.request(
      callTool('varve_invoke', {
        command: 'varve.document.save',
        args: { path: join(root, 'escape.varve') },
      }),
    );
    expect(outside.result.structuredContent.error.code).toBe('PERMISSION_DENIED');
    expect(existsSync(join(root, 'escape.varve'))).toBe(false);
    mcp.end();
    await mcp.exited;
  });
});

// ── Legacy era and SDK clients ──────────────────────────────────────────────

describe('MCP stdio, legacy initialize and SDK clients', () => {
  it('serves a legacy initialize handshake with the same tools', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--grant', 'read,edit']);
    const init = await mcp.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy-raw', version: '1' },
      },
    });
    expect(init.result.serverInfo.name).toBe('varve');
    expect(typeof init.result.protocolVersion).toBe('string');
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools = await mcp.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toContain('varve_invoke');
    mcp.end();
    await mcp.exited;
  });

  it('can be told to refuse legacy clients with the supported modern versions', async () => {
    const mcp = new LineProcess(['mcp', '--new', 'Demo', '--legacy', 'reject']);
    const init = await mcp.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy-raw', version: '1' },
      },
    });
    expect(init.error).toBeDefined();
    expect(JSON.stringify(init.error)).toContain('2026-07-28');
    mcp.end();
    await mcp.exited;
  });

  it('works with the v1 SDK client (initialize handshake)', async () => {
    const client = new ClientV1({ name: 'sdk-v1', version: '1' });
    const transport = new StdioV1({
      command: process.execPath,
      args: [bundle, 'mcp', '--new', 'V1', '--grant', 'read,edit'],
      env: { PATH: '' },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('varve_session');
    const result = await client.callTool({ name: 'varve_session', arguments: {} });
    expect((result.structuredContent as { mode: string }).mode).toBe('headless');
    const created = await client.callTool({
      name: 'varve_invoke',
      arguments: { command: 'varve.node.create', args: rect },
    });
    expect((created.structuredContent as { outcome: string }).outcome).toBe('applied');
    await client.close();
  }, 60_000);

  it('works with the v2 SDK client pinned to 2026-07-28', async () => {
    const client = new ClientV2(
      { name: 'sdk-v2', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StdioV2({
      command: process.execPath,
      args: [bundle, 'mcp', '--new', 'V2', '--grant', 'read,edit'],
      env: { PATH: '' },
    });
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(6);
    const result = await client.callTool({ name: 'varve_session', arguments: {} });
    expect((result.structuredContent as { mode: string }).mode).toBe('headless');
    await client.close();
  }, 60_000);

  it('works with the v2 SDK client in legacy handshake mode', async () => {
    const client = new ClientV2({ name: 'sdk-v2-legacy', version: '1' });
    const transport = new StdioV2({
      command: process.execPath,
      args: [bundle, 'mcp', '--new', 'V2L', '--grant', 'read'],
      env: { PATH: '' },
    });
    await client.connect(transport);
    const result = await client.callTool({
      name: 'varve_query',
      arguments: { command: 'varve.document.info' },
    });
    expect((result.structuredContent as { outcome: string }).outcome).toBe('ok');
    await client.close();
  }, 60_000);
});

// ── Control socket, raw client ──────────────────────────────────────────────

interface Ready {
  event: string;
  endpoint: string;
  tokenFile: string;
  instanceId: string;
  grants: string[];
  mode: string;
}

async function startServe(
  extra: string[] = [],
): Promise<{ proc: LineProcess; ready: Ready; token: string }> {
  const doc = fixtureDoc();
  const proc = new LineProcess(['serve', '--file', doc, '--grant', 'read,edit', ...extra]);
  const line = await proc.nextLineMatching((m) => m.event === 'ready');
  const ready = line as unknown as Ready;
  return { proc, ready, token: readFileSync(ready.tokenFile, 'utf8').trim() };
}

class RawSocket {
  readonly socket: net.Socket;
  readonly lines: string[] = [];
  closed = false;
  private buffer = '';
  private waiters: Array<() => void> = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i = this.buffer.indexOf('\n');
      while (i >= 0) {
        this.lines.push(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        i = this.buffer.indexOf('\n');
      }
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on('close', () => {
      this.closed = true;
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on('error', () => undefined);
  }

  static connect(path: string): Promise<RawSocket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(path);
      socket.once('connect', () => resolve(new RawSocket(socket)));
      socket.once('error', reject);
    });
  }

  async read(timeoutMs = 10_000): Promise<Record<string, any>> {
    const deadline = Date.now() + timeoutMs;
    while (this.lines.length === 0) {
      if (this.closed) throw new Error('socket closed');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a line');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return JSON.parse(this.lines.shift() as string) as Record<string, any>;
  }

  write(text: string | Buffer): void {
    this.socket.write(text);
  }

  async waitClosed(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('socket did not close');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

const helloFrame = (token: string, id: number | string = 1) =>
  `${JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'session.hello',
    params: {
      credential: token,
      client: { name: 'raw-socket', version: '1' },
      protocolVersions: ['varve.control/1'],
    },
  })}\n`;

describe('control socket (varve serve), raw client', () => {
  it('creates an owner-only instance directory and credential file, and no secret in the record', async () => {
    const { proc, ready, token } = await startServe();
    if (process.platform !== 'win32') {
      const dir = dirname(ready.tokenFile);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(ready.tokenFile).mode & 0o777).toBe(0o600);
    }
    const record = readFileSync(join(dirname(ready.tokenFile), 'instance.json'), 'utf8');
    expect(record).not.toContain(token);
    expect(JSON.stringify(ready)).not.toContain(token);
    expect(ready.mode).toBe('headless');
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('refuses everything before a valid hello and closes the connection', async () => {
    const { proc, ready } = await startServe();
    const early = await RawSocket.connect(ready.endpoint);
    early.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'command.execute', params: {} })}\n`,
    );
    const reply = await early.read();
    expect(reply.error.code).toBe(-32002);
    await early.waitClosed();

    const garbage = await RawSocket.connect(ready.endpoint);
    garbage.write('GET /admin HTTP/1.1\r\n');
    const parseError = await garbage.read();
    expect(parseError.error.code).toBe(-32700);
    await garbage.waitClosed();
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('closes after repeated wrong credentials and never leaks the real one', async () => {
    const { proc, ready, token } = await startServe();
    const s = await RawSocket.connect(ready.endpoint);
    for (let i = 0; i < 3; i++) {
      s.write(helloFrame('not-the-token', i + 1));
      const r = await s.read();
      expect(r.error.code).toBe(-32001);
      expect(JSON.stringify(r)).not.toContain(token);
    }
    await s.waitClosed();
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('authenticates, pipelines requests in order, and handles multibyte frames split across writes', async () => {
    const { proc, ready, token } = await startServe();
    const s = await RawSocket.connect(ready.endpoint);
    s.write(helloFrame(token));
    const hello = await s.read();
    expect(hello.result.session.mode).toBe('headless');

    const text = `${JSON.stringify({
      jsonrpc: '2.0',
      id: 't',
      method: 'command.execute',
      params: {
        command: 'varve.node.create',
        args: { kind: 'text', x: 0, y: 0, text: '日本語 \u{1F600}' },
      },
    })}\n`;
    const bytes = Buffer.from(text, 'utf8');
    for (let i = 0; i < bytes.length; i += 7) {
      s.write(bytes.subarray(i, i + 7));
      await new Promise((r) => setTimeout(r, 1));
    }
    const created = await s.read();
    expect(created.id).toBe('t');
    expect(created.result.outcome).toBe('applied');

    // Two requests in one write are answered in order.
    const two = [1, 2]
      .map((n) =>
        JSON.stringify({
          jsonrpc: '2.0',
          id: `p${n}`,
          method: 'command.execute',
          params: { command: 'varve.document.info', args: {} },
        }),
      )
      .join('\n');
    s.write(`${two}\n`);
    expect((await s.read()).id).toBe('p1');
    expect((await s.read()).id).toBe('p2');
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('discards an oversize frame without buffering it, closes that client, and keeps serving others', async () => {
    const { proc, ready, token } = await startServe();
    const big = await RawSocket.connect(ready.endpoint);
    big.write(helloFrame(token));
    await big.read();
    // 6 MiB with no newline: larger than the 4 MiB post-auth limit.
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    for (let i = 0; i < 6; i++) big.write(chunk);
    const refusal = await big.read();
    expect(refusal.error.code).toBe(-32003);
    await big.waitClosed();

    const other = await RawSocket.connect(ready.endpoint);
    other.write(helloFrame(token));
    expect((await other.read()).result.protocol).toBe('varve.control/1');
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('shares one document authority between clients, and one disconnecting does not stop the session', async () => {
    const { proc, ready, token } = await startServe();
    const a = await RawSocket.connect(ready.endpoint);
    const b = await RawSocket.connect(ready.endpoint);
    a.write(helloFrame(token));
    b.write(helloFrame(token));
    await a.read();
    await b.read();
    a.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'command.execute',
        params: { command: 'varve.node.create', args: rect },
      })}\n`,
    );
    expect((await a.read()).result.revision.after).toBe(1);
    a.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session.close', params: {} })}\n`);
    await a.read();
    await a.waitClosed();

    b.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'command.execute',
        params: { command: 'varve.document.info', args: {} },
      })}\n`,
    );
    const info = await b.read();
    expect(info.result.output.revision).toBe(1);
    expect(proc.child.exitCode).toBeNull();
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('lists and verifies instances without exposing credentials, and cleans up on SIGTERM', async () => {
    const { proc, ready, token } = await startServe();
    const listed = spawnSync(process.execPath, [bundle, 'instances', '--verify', '--json'], {
      encoding: 'utf8',
      env: { PATH: '', VARVE_RUNTIME_DIR: runtimeDir },
    });
    expect(listed.status).toBe(0);
    expect(listed.stdout).not.toContain(token);
    const out = JSON.parse(listed.stdout) as {
      instances: Array<{ instanceId: string; verified?: { mode: string } }>;
    };
    const mine = out.instances.find((i) => i.instanceId === ready.instanceId);
    expect(mine?.verified?.mode).toBe('headless');

    const dir = dirname(ready.tokenFile);
    proc.child.kill('SIGTERM');
    expect(await proc.exited).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it('holds the document lock for the session so a second writer is refused', async () => {
    const doc = fixtureDoc();
    const proc = new LineProcess(['serve', '--file', doc, '--in-place', '--grant', 'read,edit']);
    await proc.nextLineMatching((m) => m.event === 'ready');
    const second = spawnSync(
      process.execPath,
      [
        bundle,
        'exec',
        'varve.node.create',
        '--file',
        doc,
        '--args-json',
        JSON.stringify(rect),
        '--in-place',
      ],
      { encoding: 'utf8', env: { PATH: '' } },
    );
    expect(second.status).toBe(5);
    expect(second.stderr).toContain('locked');
    proc.child.kill('SIGTERM');
    await proc.exited;
    expect(existsSync(`${doc}.varve-lock`)).toBe(false);
  });
});

// ── MCP attached to a control endpoint ──────────────────────────────────────

describe('MCP attach mode never falls back to a headless document', () => {
  it('attaches to a running endpoint and shares its document', async () => {
    const { proc, ready } = await startServe();
    const mcp = new LineProcess(['mcp', '--instance', ready.instanceId, '--grant', 'read']);
    const created = await mcp.request(
      callTool('varve_invoke', { command: 'varve.node.create', args: rect }),
    );
    expect(created.result.structuredContent.outcome).toBe('applied');
    const session = await mcp.request(callTool('varve_session'));
    expect(session.result.structuredContent.instanceId).toBe(ready.instanceId);
    expect(session.result.structuredContent.revision).toBe(1);
    mcp.end();
    await mcp.exited;
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('exits with an error when the endpoint is unreachable, without opening a document', async () => {
    const tokenFile = join(root, 'dead-token');
    writeFileSync(tokenFile, 'x', { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [bundle, 'mcp', '--connect', join(root, 'no-such.sock'), '--token-file', tokenFile],
      { encoding: 'utf8', env: { PATH: '' }, input: '' },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('Not falling back');
    expect(result.stdout).toBe('');
  });

  it('refuses a credential file other users can read, and says how to fix it', async () => {
    const tokenFile = join(root, 'lax-token');
    writeFileSync(tokenFile, 'x', { mode: 0o644 });
    chmodSync(tokenFile, 0o644);
    const result = spawnSync(
      process.execPath,
      [bundle, 'mcp', '--connect', join(root, 'no-such.sock'), '--token-file', tokenFile],
      { encoding: 'utf8', env: { PATH: '' }, input: '' },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('readable by other users');
    expect(result.stderr).toContain('chmod 600');
    // It stopped before connecting anywhere or reading the file's contents.
    expect(result.stderr).not.toContain('Not falling back');
    expect(result.stdout).toBe('');
  });

  it('refuses a session of the wrong kind when a mode is required', async () => {
    const { proc, ready } = await startServe();
    const result = spawnSync(
      process.execPath,
      [bundle, 'mcp', '--instance', ready.instanceId, '--require-mode', 'connected'],
      {
        encoding: 'utf8',
        env: { PATH: '', VARVE_RUNTIME_DIR: runtimeDir },
        input: '',
      },
    );
    expect(result.status).toBe(5);
    expect(result.stderr).toContain('refusing to continue');
    proc.child.kill('SIGTERM');
    await proc.exited;
  });

  it('requires an explicit choice between headless and attached', () => {
    const result = spawnSync(process.execPath, [bundle, 'mcp'], {
      encoding: 'utf8',
      env: { PATH: '' },
      input: '',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('choose exactly one');
  });
});
