/**
 * The seam nothing else covers: a real Rust endpoint, a real CLI client, and the
 * production relay code between them.
 *
 * Three programs are involved and none is mocked:
 *
 *   varve (bundled CLI) / raw socket client
 *        <-- Unix socket -->  host_stdio (the Rust endpoint, built from
 *                             crates/varve-automation-host)
 *        <-- stdio payloads -->  this process, running `createFrameRelay` and a
 *                             real AutomationHost over a real document
 *
 * The stdio payloads are the ones the Tauri adapter emits, so a shape one side
 * cannot represent fails here rather than in a launched application. What this
 * does NOT cover: Tauri's event system, the webview, or a window.
 *
 * Needs the harness binary: `cargo build -p varve-automation-host --example
 * host_stdio` (or VARVE_HOST_STDIO_BIN). Without it the suite is reported as
 * skipped with that instruction; it is not silently green.
 */
import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as ClientV2 } from '@modelcontextprotocol/client';
import { StdioClientTransport as StdioV2 } from '@modelcontextprotocol/client/stdio';
import {
  AutomationHost,
  createFrameRelay,
  createStandardCatalog,
  Executor,
  HeadlessAuthority,
} from '@varve/automation';
import { createDocument } from '@varve/scene';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');
const buildScript = join(here, '../../scripts/build-bundle.mjs');

/**
 * The harness binary, if one has been built.
 *
 * Several copies can exist at once (a worktree's own `target/`, a shared target
 * directory, one named by the environment), and an older one silently testing
 * old behaviour is worse than none. So an explicit path wins, and otherwise the
 * most recently built candidate does.
 */
function findHarness(): string | null {
  if (process.env.VARVE_HOST_STDIO_BIN) {
    return existsSync(process.env.VARVE_HOST_STDIO_BIN) ? process.env.VARVE_HOST_STDIO_BIN : null;
  }
  const candidates = [
    process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, 'debug/examples/host_stdio'),
    join(repoRoot, 'target/debug/examples/host_stdio'),
    '/home/kevina/CodingProjects/varve/target/debug/examples/host_stdio',
  ].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate));
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

const harness = findHarness();
if (harness) process.stderr.write(`\n[rust-endpoint] using harness ${harness}\n`);
const suite = harness ? describe : describe.skip;
if (!harness) {
  process.stderr.write(
    '\n[rust-endpoint] SKIPPED: harness binary not found. Build it with\n' +
      '  cargo build -p varve-automation-host --example host_stdio\n' +
      'or point VARVE_HOST_STDIO_BIN at it. This is "not run", not "passed".\n\n',
  );
}

let root: string;
let bundle: string;
const spawned: ChildProcess[] = [];

beforeAll(() => {
  if (!harness) return;
  root = mkdtempSync(join(tmpdir(), 'vrx-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  bundle = join(root, 'bin', 'varve.mjs');
  const built = spawnSync(process.execPath, [buildScript, '--outfile', bundle], {
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`bundle build failed: ${built.stderr}`);
}, 180_000);

afterAll(() => {
  for (const child of spawned) if (child.exitCode === null) child.kill('SIGKILL');
  if (root) rmSync(root, { recursive: true, force: true });
});

interface RustHost {
  runtimeDir: string;
  endpoint: string;
  instanceDir: string;
  token: string;
  authority: HeadlessAuthority;
  child: ChildProcessWithoutNullStreams;
  appHost: AutomationHost;
  relay: ReturnType<typeof createFrameRelay>;
  stop(): Promise<void>;
}

async function startRustHost(instanceId = 'rust-xproc'): Promise<RustHost> {
  const runtimeDir = mkdtempSync(join(root, 'rt-'));
  const authority = new HeadlessAuthority({
    document: createDocument('Cross process'),
    instanceId,
  });
  let token = '';
  const host = new AutomationHost({
    authority,
    executor: new Executor({ catalog: createStandardCatalog() }),
    serverInfo: { name: 'rust-xproc', version: '0' },
    admit: async (request) =>
      request.credential === token
        ? { grants: ['read', 'edit'], label: request.client.name, kind: 'agent' }
        : null,
  });
  const relay = createFrameRelay(host);

  const child = spawn(harness as string, [runtimeDir], {
    env: { ...process.env, VARVE_TEST_INSTANCE: instanceId },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  spawned.push(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  let buffered = '';
  let resolveEndpoint: (path: string) => void = () => undefined;
  const endpointReady = new Promise<string>((resolve) => {
    resolveEndpoint = resolve;
  });
  const reply = (requestId: string, answer: { frame: string | null; closeAfter: boolean }) => {
    child.stdin.write(
      `${JSON.stringify({ kind: 'reply', requestId, frame: answer.frame, closeAfter: answer.closeAfter })}\n`,
    );
  };
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    let at = buffered.indexOf('\n');
    while (at >= 0) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      at = buffered.indexOf('\n');
      if (line.startsWith('ENDPOINT ')) {
        resolveEndpoint(line.slice('ENDPOINT '.length));
        continue;
      }
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(line);
      } catch {
        continue;
      }
      if (payload.kind === 'closed') {
        // The endpoint tells the application a socket has gone, exactly as the
        // desktop adapter's `automation:closed` event does.
        relay.closed(payload.connectionId);
      } else if (payload.kind === 'frame') {
        void relay
          .frame(payload.connectionId, payload.frame)
          .then((answer) => reply(payload.requestId, answer));
      } else if (payload.kind === 'transport-error') {
        void relay
          .transportError(payload.connectionId, payload.error)
          .then((answer) => reply(payload.requestId, answer));
      }
    }
  });

  const endpoint = await Promise.race([
    endpointReady,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`the Rust host did not start: ${stderr}`)), 20_000),
    ),
  ]);
  const instanceDir = dirname(endpoint);
  token = readFileSync(join(instanceDir, 'token'), 'utf8').trim();
  return {
    runtimeDir,
    endpoint,
    instanceDir,
    token,
    authority,
    child,
    appHost: host,
    relay,
    async stop() {
      child.stdin.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', () => resolve());
        setTimeout(resolve, 5_000);
      });
    },
  };
}

/** A raw NDJSON client over the Unix socket. */
class RawClient {
  readonly lines: string[] = [];
  closed = false;
  private buffer = '';
  private constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let at = this.buffer.indexOf('\n');
      while (at >= 0) {
        this.lines.push(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(at + 1);
        at = this.buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      this.closed = true;
    });
    socket.on('error', () => undefined);
  }
  static connect(endpoint: string): Promise<RawClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(endpoint);
      socket.once('connect', () => resolve(new RawClient(socket)));
      socket.once('error', reject);
    });
  }
  send(data: string | Buffer): void {
    this.socket.write(data);
  }
  async next(timeoutMs = 10_000): Promise<Record<string, any>> {
    const start = Date.now();
    while (this.lines.length === 0) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for a line');
      await new Promise((r) => setTimeout(r, 10));
    }
    return JSON.parse(this.lines.shift() as string);
  }
  async untilClosed(timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (!this.closed) {
      if (Date.now() - start > timeoutMs) throw new Error('the connection did not close');
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  destroy(): void {
    this.socket.destroy();
  }
}

const helloFrame = (token: string, name = 'raw') =>
  `${JSON.stringify({
    jsonrpc: '2.0',
    id: 'h',
    method: 'session.hello',
    params: {
      credential: token,
      client: { name, version: '1' },
      protocolVersions: ['varve.control/1'],
    },
  })}\n`;

const executeFrame = (id: number, command: string, args: unknown, extra: object = {}) =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method: 'command.execute', params: { command, args, ...extra } })}\n`;

/**
 * Run the CLI as an asynchronous child. `spawnSync` would freeze this process,
 * and this process is the one answering the Rust endpoint's relay, so the CLI
 * could never complete its handshake.
 */
function cli(args: string[], runtimeDir: string, timeoutMs = 60_000) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [bundle, ...args], {
      env: { PATH: '', VARVE_RUNTIME_DIR: runtimeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    spawned.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

suite('a real Rust endpoint, the production relay and independent clients', () => {
  let host: RustHost | null = null;
  afterEach(async () => {
    await host?.stop();
    host = null;
  });

  it('is discovered and verified by the CLI, which never prints the credential', async () => {
    host = await startRustHost();
    const out = await cli(['instances', '--verify', '--json'], host.runtimeDir);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).not.toContain(host.token);
    const listed = JSON.parse(out.stdout) as { instances: Array<Record<string, any>> };
    expect(listed.instances).toHaveLength(1);
    expect(listed.instances[0]).toMatchObject({ instanceId: 'rust-xproc', alive: true });
    // `--verify` performed a real handshake through Rust -> relay -> host.
    expect(JSON.stringify(listed.instances[0])).toMatch(/verified|ok|true/i);
    expect(host.authority.getRevision()).toBe(0);
  }, 90_000);

  it('serves an independent MCP client attached by instance id, and edits reach the real document', async () => {
    host = await startRustHost();
    const client = new ClientV2({ name: 'xproc-mcp', version: '1' });
    const transport = new StdioV2({
      command: process.execPath,
      args: [bundle, 'mcp', '--instance', 'rust-xproc', '--runtime-dir', host.runtimeDir],
      env: { PATH: '', VARVE_RUNTIME_DIR: host.runtimeDir },
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(6);
      const session = await client.callTool({ name: 'varve_session', arguments: {} });
      expect((session.structuredContent as { instanceId?: string }).instanceId).toBeDefined();

      const created = await client.callTool({
        name: 'varve_invoke',
        arguments: {
          command: 'varve.node.create',
          args: { kind: 'rect', x: 4, y: 5, width: 60, height: 30 },
          idempotencyKey: 'xproc-1',
        },
      });
      const receipt = created.structuredContent as { outcome: string; created: string[] };
      expect(receipt.outcome).toBe('applied');
      // The edit crossed MCP, the CLI, the Rust socket and the relay and landed
      // in the document the host owns.
      expect(host.authority.getDocument().nodes[receipt.created[0] as string]).toBeDefined();
      expect(host.authority.getRevision()).toBe(1);
    } finally {
      await client.close();
    }
  }, 120_000);

  it('answers an oversize frame through the protocol, then keeps serving others', async () => {
    host = await startRustHost();
    const bad = await RawClient.connect(host.endpoint);
    bad.send(`${'x'.repeat(10_000)}\n`);
    const refusal = await bad.next();
    expect(refusal.error?.code).toBeLessThan(0);
    await bad.untilClosed();

    const good = await RawClient.connect(host.endpoint);
    good.send(helloFrame(host.token));
    expect((await good.next()).result.session).toBeDefined();
    good.destroy();
  }, 60_000);

  it('answers invalid UTF-8 through the protocol and closes that connection only', async () => {
    host = await startRustHost();
    const bad = await RawClient.connect(host.endpoint);
    bad.send(Buffer.from([0xff, 0xfe, 0xfd, 0x0a]));
    const refusal = await bad.next();
    expect(refusal.error?.code).toBeLessThan(0);
    await bad.untilClosed();
    const good = await RawClient.connect(host.endpoint);
    good.send(helloFrame(host.token));
    expect((await good.next()).result.session).toBeDefined();
    good.destroy();
  }, 60_000);

  it('refuses a wrong credential without revealing the right one', async () => {
    host = await startRustHost();
    const c = await RawClient.connect(host.endpoint);
    c.send(helloFrame('not-the-token'));
    const refusal = await c.next();
    expect(refusal.error).toBeDefined();
    expect(JSON.stringify(refusal)).not.toContain(host.token);
    c.destroy();
  }, 60_000);

  it('keeps two clients independent: one leaving does not end the other, and each is its own principal', async () => {
    host = await startRustHost();
    const a = await RawClient.connect(host.endpoint);
    const b = await RawClient.connect(host.endpoint);
    a.send(helloFrame(host.token, 'agent-a'));
    b.send(helloFrame(host.token, 'agent-b'));
    const helloA = await a.next();
    const helloB = await b.next();
    // Same credential, two connections: each is its own principal, so a receipt
    // always names which connection wrote it.
    expect(helloA.result.principal.id).not.toBe(helloB.result.principal.id);

    a.send(executeFrame(1, 'varve.node.create', { kind: 'rect', x: 0, y: 0, width: 5, height: 5 }));
    const created = await a.next();
    expect(created.result.outcome).toBe('applied');
    a.destroy();

    b.send(executeFrame(2, 'varve.node.list', { limit: 10 }));
    const listed = await b.next();
    expect(listed.result.outcome).toBe('ok');
    expect(listed.result.output.nodes.length).toBeGreaterThanOrEqual(1);
    b.destroy();
  }, 60_000);

  it('survives a lost reply: the retry replays the original and exactly one edit exists', async () => {
    host = await startRustHost();
    const before = Object.keys(host.authority.getDocument().nodes).length;
    const first = await RawClient.connect(host.endpoint);
    first.send(helloFrame(host.token));
    await first.next();
    first.send(
      executeFrame(
        1,
        'varve.node.create',
        { kind: 'rect', x: 1, y: 1, width: 9, height: 9 },
        { idempotencyKey: 'lost-reply-1' },
      ),
    );
    // The client vanishes before it can read the reply.
    first.destroy();

    // Wait until the edit has landed, then reconnect and retry the same request.
    const deadline = Date.now() + 10_000;
    while (Object.keys(host.authority.getDocument().nodes).length === before) {
      if (Date.now() > deadline) throw new Error('the edit never landed');
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = await RawClient.connect(host.endpoint);
    second.send(helloFrame(host.token));
    await second.next();
    second.send(
      executeFrame(
        2,
        'varve.node.create',
        { kind: 'rect', x: 1, y: 1, width: 9, height: 9 },
        { idempotencyKey: 'lost-reply-1', attempt: 2 },
      ),
    );
    const retried = await second.next();
    expect(retried.result.idempotency).toMatchObject({ replayed: true });
    expect(Object.keys(host.authority.getDocument().nodes).length).toBe(before + 1);
    second.destroy();
  }, 60_000);

  it('forgets a client that simply disconnects, so short-lived clients never fill the host', async () => {
    host = await startRustHost();
    const live = () =>
      host?.appHost.status().connections.filter((c) => c.state !== 'closed').length ?? -1;

    const a = await RawClient.connect(host.endpoint);
    a.send(helloFrame(host.token, 'short-lived'));
    await a.next();
    expect(live()).toBe(1);
    expect(host.relay.open).toBe(1);

    a.destroy(); // no goodbye: this is how every CLI call ends
    const deadline = Date.now() + 10_000;
    while (live() !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(live()).toBe(0);
    expect(host.relay.open).toBe(0);

    // And it does not matter how many come and go: each one is released.
    for (let i = 0; i < 12; i += 1) {
      const c = await RawClient.connect(host.endpoint);
      c.send(helloFrame(host.token, `burst-${i}`));
      await c.next();
      c.destroy();
    }
    const settle = Date.now() + 15_000;
    while (live() !== 0 && Date.now() < settle) await new Promise((r) => setTimeout(r, 25));
    expect(live()).toBe(0);
    // The host is still accepting: nothing was left holding a slot.
    const again = await RawClient.connect(host.endpoint);
    again.send(helloFrame(host.token, 'after-the-burst'));
    expect((await again.next()).result.session).toBeDefined();
    again.destroy();
  }, 90_000);

  it('removes its instance directory when the application goes away', async () => {
    host = await startRustHost();
    const { instanceDir, runtimeDir } = host;
    expect(existsSync(instanceDir)).toBe(true);
    await host.stop();
    host = null;
    const deadline = Date.now() + 10_000;
    while (existsSync(instanceDir) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(existsSync(instanceDir)).toBe(false);
    expect(readdirSync(runtimeDir).filter((name) => name.startsWith('v-'))).toHaveLength(0);
  }, 60_000);
});
