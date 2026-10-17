/**
 * Agent access in the real desktop application.
 *
 * Everything the browser run cannot establish: the native app's Settings turn on
 * a real Unix-socket endpoint in Rust, a separate client process attaches to the
 * *running window's* document through it, a held change is approved by clicking
 * the real button in the real window, and a capture comes from the native
 * WebKit engine's own canvas.
 *
 * Opt-in. It needs an isolated runtime directory and an isolated profile, both
 * set before the app launches (the application keeps its settings and recovery
 * data between launches, and a harness that ends it abruptly leaves a recovery
 * prompt and eventually Safe mode behind):
 *
 *   RUN=$(mktemp -d)
 *   VARVE_RUNTIME_DIR=$RUN/run XDG_DATA_HOME=$RUN/data XDG_CONFIG_HOME=$RUN/config \
 *   XDG_CACHE_HOME=$RUN/cache VARVE_WDIO_SPECS=./tests/wdio/agent-access.e2e.ts \
 *   xvfb-run -a -s "-screen 0 1280x900x24" pnpm exec wdio run wdio.conf.ts
 *
 * with the debug binary built using `--features wdio` (see
 * scripts/desktop/native-smoke.mjs for the build arguments).
 *
 * Under xvfb the window never appears on a person's screen.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@wdio/globals';

const RUNTIME = process.env.VARVE_RUNTIME_DIR;
const REPO = process.cwd();
const artifacts = resolve(REPO, 'artifacts/desktop');
let bundleDir = '';
let bundle = '';

function cli(args: string[]) {
  return spawnSync(process.execPath, [bundle, ...args], {
    encoding: 'utf8',
    env: { PATH: '', VARVE_RUNTIME_DIR: RUNTIME },
    timeout: 60_000,
  });
}

/** A raw NDJSON client over the application's real socket. */
class RawClient {
  private buffer = '';
  private readonly lines: string[] = [];
  closed = false;
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
    return new Promise((resolveConnect, reject) => {
      const socket = net.connect(endpoint);
      socket.once('connect', () => resolveConnect(new RawClient(socket)));
      socket.once('error', reject);
    });
  }
  send(line: string): void {
    this.socket.write(`${line}\n`);
  }
  async next(timeoutMs = 20_000): Promise<Record<string, any>> {
    const start = Date.now();
    while (this.lines.length === 0) {
      if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for a reply');
      await new Promise((r) => setTimeout(r, 25));
    }
    return JSON.parse(this.lines.shift() as string);
  }
  destroy(): void {
    this.socket.destroy();
  }
}

interface InstanceRow {
  instanceId: string;
  endpoint: string;
  alive: boolean;
  mode: string;
  verified?: { mode?: string; instanceId?: string; documentId?: string; error?: string };
}

function listInstances(verify = false): InstanceRow[] {
  const out = cli(['instances', '--json', ...(verify ? ['--verify'] : [])]);
  if (out.status !== 0)
    throw new Error(`varve ${args.join(' ')} exited ${out.status}: ${out.stderr}`);
  return (JSON.parse(out.stdout) as { instances: InstanceRow[] }).instances;
}

function tokenFor(row: InstanceRow): string {
  const dir = join(
    RUNTIME as string,
    readdirSync(RUNTIME as string).find((n) => n.startsWith('v-')) as string,
  );
  expect(row.endpoint.startsWith(dir)).toBe(true);
  return readFileSync(join(dir, 'token'), 'utf8').trim();
}

// ── Driving the real window ────────────────────────────────────────────────

async function openNewDocument(): Promise<void> {
  await browser.tauri.switchWindow('main');
  const homeButton = await browser.$('.editor-menubar__home');
  if (await homeButton.isDisplayed().catch(() => false)) await homeButton.click();
  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30_000 });
  await newButton.click();
  const createButton = await browser.$('[data-testid="create-design-button"]');
  await createButton.waitForDisplayed({ timeout: 5_000 });
  await createButton.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30_000 });
}

async function clickText(
  candidates: string,
  exact: string | null,
  prefix: string | null,
): Promise<void> {
  await browser.tauri.execute(
    (_tauri: unknown, selector: string, wantExact: string | null, wantPrefix: string | null) => {
      const el = [...document.querySelectorAll(selector)].find((e) => {
        const text = e.textContent?.trim() ?? '';
        if (e.children.length !== 0) return false;
        if (wantExact !== null) return text === wantExact;
        return wantPrefix !== null && text.toLowerCase().startsWith(wantPrefix);
      });
      (el as HTMLElement | undefined)?.click();
    },
    candidates,
    exact,
    prefix,
  );
}

async function clickButton(label: string): Promise<void> {
  await browser.tauri.execute((_tauri: unknown, wanted: string) => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === wanted,
    );
    (button as HTMLElement | undefined)?.click();
  }, label);
}

function helloLine(token: string, name: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 'h',
    method: 'session.hello',
    params: {
      credential: token,
      client: { name, version: '1' },
      protocolVersions: ['varve.control/1'],
    },
  });
}

/**
 * The test application's profile survives between runs, and the harness ends it
 * abruptly, so the next launch can offer to recover documents. A person would
 * dismiss that; leave it alone and it sits on top of everything else.
 */
async function dismissRecoveryPrompt(): Promise<void> {
  await browser.tauri.execute(() => {
    const close = document.querySelector<HTMLElement>(
      'dialog.recovery-dialog[open] button[aria-label="Close"], .recovery-dialog[open] button[aria-label="Close"]',
    );
    close?.click();
  });
}

async function closeSettings(): Promise<void> {
  await browser.tauri.execute(() => {
    document
      .querySelector<HTMLElement>('dialog.varve-dialog--settings button[aria-label="Close dialog"]')
      ?.click();
  });
  await browser.waitUntil(
    () =>
      browser.tauri.execute(
        () => document.querySelector('dialog.varve-dialog--settings[open]') === null,
      ),
    { timeout: 10_000, timeoutMsg: 'Settings did not close' },
  );
}

async function openAgentAccess(): Promise<void> {
  await dismissRecoveryPrompt();
  const menuTargets = 'button, [role="menuitem"], [role="tab"], div, span';
  await clickText(menuTargets, 'File', null);
  // The menu renders after the click; give React a frame before choosing an item.
  await browser.pause(300);
  await clickText(menuTargets, null, 'settings');
  await browser.waitUntil(
    () =>
      browser.tauri.execute(
        () => document.querySelector('dialog.varve-dialog--settings[open]') !== null,
      ),
    { timeout: 15_000, timeoutMsg: 'Settings did not open' },
  );
  await clickText('[role="tab"]', 'Agent Access', null);
  await browser.waitUntil(
    () => browser.tauri.execute(() => document.querySelector('.agent-access') !== null),
    { timeout: 15_000, timeoutMsg: 'Agent Access did not render' },
  );
}

const clickById = (id: string) =>
  browser.tauri.execute((_tauri: unknown, target: string) => {
    (document.getElementById(target) as HTMLElement | null)?.click();
  }, id);

/**
 * Put a switch in the wanted state. The test application keeps its profile
 * between runs, so a switch can already be on; clicking it blindly would turn
 * it off.
 */
async function setSwitch(id: string, wanted: boolean): Promise<void> {
  const current = await browser.tauri.execute(
    (_tauri: unknown, target: string) =>
      (document.getElementById(target) as HTMLInputElement | null)?.checked ?? null,
    id,
  );
  if (current === null) throw new Error(`switch ${id} is not on the page`);
  if (current !== wanted) await clickById(id);
  await browser.waitUntil(
    async () =>
      (await browser.tauri.execute(
        (_tauri: unknown, target: string) =>
          (document.getElementById(target) as HTMLInputElement | null)?.checked ?? null,
        id,
      )) === wanted,
    { timeout: 10_000, timeoutMsg: `switch ${id} did not become ${wanted ? 'on' : 'off'}` },
  );
}

const statusText = () =>
  browser.tauri.execute(
    () => document.querySelector('[aria-label="Agent access status"]')?.textContent ?? '',
  );

const layerCount = () =>
  browser.tauri.execute(() => document.querySelectorAll('[role="treeitem"]').length);

describe('Tauri Desktop: agent access over a real endpoint', function () {
  this.timeout(180_000);

  before(() => {
    if (!RUNTIME) {
      throw new Error(
        'VARVE_RUNTIME_DIR must be set before the app launches, so this spec and the app share an isolated endpoint directory.',
      );
    }
    mkdirSync(artifacts, { recursive: true });
    bundleDir = mkdtempSync(join(tmpdir(), 'vwd-'));
    bundle = join(bundleDir, 'varve.mjs');
    const built = spawnSync(
      process.execPath,
      [resolve(REPO, 'packages/cli/scripts/build-bundle.mjs'), '--outfile', bundle],
      {
        encoding: 'utf8',
      },
    );
    if (built.status !== 0) throw new Error(`could not build the CLI bundle: ${built.stderr}`);
  });

  after(() => {
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
  });

  it('starts with nothing listening', async () => {
    await openNewDocument();
    await openAgentAccess();
    expect(await statusText()).toContain('Off');
    expect(listInstances().filter((i) => i.alive)).toHaveLength(0);
  });

  it('turning it on starts a real endpoint that names the running window', async () => {
    await setSwitch('agent-access-edit', true);
    await setSwitch('agent-access-capture', true);
    await setSwitch('agent-access-enabled', true);
    await browser.waitUntil(async () => (await statusText()).includes('Running'), {
      timeout: 30_000,
      timeoutMsg: `the endpoint never reached Running; status: ${await statusText()}`,
    });
    const command = await browser.tauri.execute(
      () => document.querySelector('.agent-access__command')?.textContent ?? '',
    );
    expect(command).toMatch(/^varve mcp --instance /);

    const rows = listInstances(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.alive).toBe(true);
    // A handshake through the real Rust socket, the real relay and the real
    // controller reported a connected session, not a headless copy.
    expect(rows[0]?.verified?.error).toBeUndefined();
    expect(rows[0]?.verified?.mode).toBe('connected');
    expect(command).toContain(rows[0]?.instanceId as string);

    // `varve instances --verify` has exited. A client that simply disconnects
    // must not stay listed as connected: sessions would pile up until the
    // connection cap turned real clients away.
    await browser.waitUntil(
      async () =>
        !(await browser.tauri.execute(
          () =>
            document
              .querySelector('[aria-label="Connected agents"]')
              ?.textContent?.includes('varve instances') ?? false,
        )),
      { timeout: 15_000, timeoutMsg: 'a client that disconnected is still listed as connected' },
    );
  });

  let client: RawClient;
  let created: string;

  it('a separate client process attaches to the open document', async () => {
    const row = listInstances()[0] as InstanceRow;
    client = await RawClient.connect(row.endpoint);
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'h',
        method: 'session.hello',
        params: {
          credential: tokenFor(row),
          client: { name: 'native-test', version: '1' },
          protocolVersions: ['varve.control/1'],
        },
      }),
    );
    const hello = await client.next();
    expect(hello.result.session.mode).toBe('connected');
    expect(hello.result.principal.grants).toEqual(
      expect.arrayContaining(['read', 'edit', 'capture']),
    );
    expect(hello.result.principal.grants).not.toContain('export');
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'command.execute',
        params: { command: 'varve.document.info', args: {} },
      }),
    );
    const info = await client.next();
    expect(info.result.outcome).toBe('ok');
    expect(info.result.output.instance.mode).toBe('connected');
  });

  it('holds a change for approval, applies it only when the real button is clicked', async () => {
    const listShapes = async (id: number) => {
      client.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'command.execute',
          params: { command: 'varve.node.list', args: { kinds: ['shape'], limit: 20 } },
        }),
      );
      const listed = await client.next();
      return (listed.result.output.nodes as Array<{ id: string }>).map((n) => n.id);
    };
    const shapesBefore = await listShapes(10);

    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'command.execute',
        params: {
          command: 'varve.node.create',
          args: { kind: 'rect', x: 10, y: 20, width: 160, height: 90, fill: '#7c3aed' },
        },
      }),
    );
    const approve = await browser.$('button=Approve');
    await approve.waitForDisplayed({ timeout: 20_000 });
    // The dialog scrolls; bring the approval into the picture.
    await browser.tauri.execute(() => {
      document
        .querySelector('[aria-label="Changes waiting for your approval"]')
        ?.scrollIntoView({ block: 'center' });
    });
    await browser.pause(500); // let the scroll paint before the picture is taken
    await browser.saveScreenshot(join(artifacts, 'native-held-approval.png'));

    await approve.click();
    const reply = await client.next();
    expect(reply.result.outcome).toBe('applied');
    created = reply.result.created[0] as string;

    // The authoritative view: the document now holds exactly one more shape,
    // and it is the one the agent was told it created.
    const shapesAfter = await listShapes(11);
    expect(shapesAfter.length).toBe(shapesBefore.length + 1);
    expect(shapesAfter).toContain(created);

    // And a person sees it. The Settings dialog is modal; close it and look at
    // the layers panel.
    await closeSettings();
    await browser.waitUntil(async () => (await layerCount()) >= 1, {
      timeout: 15_000,
      timeoutMsg: 'the approved node never appeared in the layers panel',
    });
    await browser.saveScreenshot(join(artifacts, 'native-after-approval.png'));
    await openAgentAccess();
  });

  it('captures real pixels from the native engine', async () => {
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'command.execute',
        params: {
          command: 'varve.capture.node',
          args: { nodeId: created, maxDimension: 320, background: 'white' },
        },
      }),
    );
    const reply = await client.next(60_000);
    if (reply.result.outcome !== 'applied')
      throw new Error(`capture was not applied: ${JSON.stringify(reply.result.error)}`);
    const out = reply.result.output;
    expect(out.kind).toBe('document-pixels');
    expect(out.complete).toBe(true);
    const png = Buffer.from(out.image.data as string, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // IHDR carries the real dimensions of the decoded image.
    expect(png.readUInt32BE(16)).toBe(out.width);
    expect(png.readUInt32BE(20)).toBe(out.height);
    expect(out.width).toBeGreaterThan(0);
    expect(png.length).toBeGreaterThan(200);

    // Decode it in the native engine and read the pixel in the middle of the
    // rectangle: it must be the violet the agent asked for (#7c3aed), fully
    // opaque, not merely "some image".
    const centre = await browser.tauri.execute(async (_tauri: unknown, data: string) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      return [
        ...ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data,
      ];
    }, out.image.data as string);
    const [r, g, b, a] = centre as number[];
    expect(Math.abs((r ?? 0) - 0x7c)).toBeLessThanOrEqual(3);
    expect(Math.abs((g ?? 0) - 0x3a)).toBeLessThanOrEqual(3);
    expect(Math.abs((b ?? 0) - 0xed)).toBeLessThanOrEqual(3);
    expect(a).toBe(255);
    writeFileSync(join(artifacts, 'native-capture.png'), png);
  });

  it('stops new changes when the person pauses, and says why', async () => {
    await browser.tauri.execute(() => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Pause changes',
      );
      (button as HTMLElement | undefined)?.click();
    });
    await browser.waitUntil(async () => (await statusText()).includes('Paused'), {
      timeout: 10_000,
    });
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'command.execute',
        params: {
          command: 'varve.node.create',
          args: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 },
        },
      }),
    );
    const refused = await client.next();
    expect(refused.result.outcome).toBe('rejected');
    expect(refused.result.error.message).toContain('paused');
  });

  it('withdraws a change that was waiting for approval when the person pauses', async () => {
    // Pause is still on from the previous test. Lift it, hold a request, then
    // pause again: the prompt must go away rather than stay clickable.
    await clickButton('Allow changes again');
    await browser.waitUntil(async () => !(await statusText()).includes('Paused'), {
      timeout: 10_000,
    });
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'command.execute',
        params: {
          command: 'varve.node.create',
          args: { kind: 'rect', x: 300, y: 20, width: 40, height: 40 },
        },
      }),
    );
    const approve = await browser.$('button=Approve');
    await approve.waitForDisplayed({ timeout: 20_000 });

    await clickButton('Pause changes');
    const withdrawn = await client.next();
    expect(withdrawn.result.outcome).toBe('rejected');
    expect(withdrawn.result.error.message).toContain('paused');
    await browser.waitUntil(async () => !(await (await browser.$('button=Approve')).isExisting()), {
      timeout: 10_000,
      timeoutMsg: 'the prompt for a withdrawn change is still on screen',
    });
  });

  it('Disconnect and block refuses the shared key to everyone until it is allowed again', async () => {
    const row = listInstances()[0] as InstanceRow;
    const token = tokenFor(row);

    await clickButton('Disconnect and block');
    await browser.waitUntil(async () => client.closed, {
      timeout: 10_000,
      timeoutMsg: 'the blocked client was not disconnected',
    });

    // Every client of this window presents the same key, so a different client
    // is refused too. The window says so instead of implying a per-agent switch.
    const other = await RawClient.connect(row.endpoint);
    other.send(helloLine(token, 'someone-else'));
    const refused = await other.next();
    expect(refused.error.message).toBe('credential refused');
    other.destroy();

    const blocked = await browser.$('[aria-label="Access blocked"]');
    await blocked.waitForDisplayed({ timeout: 10_000 });
    expect(await blocked.getText()).toContain('same access key');
    // The dialog scrolls; bring the block into the picture before taking it.
    await browser.tauri.execute(() => {
      document.querySelector('[aria-label="Access blocked"]')?.scrollIntoView({ block: 'center' });
    });
    await browser.pause(500); // let the scroll paint before the picture is taken
    await browser.saveScreenshot(join(artifacts, 'native-access-blocked.png'));

    await clickButton('Allow access again');
    await browser.waitUntil(
      async () => !(await (await browser.$('[aria-label="Access blocked"]')).isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: 'the block is still shown after it was lifted',
      },
    );

    client.destroy();
    client = await RawClient.connect(row.endpoint);
    client.send(helloLine(token, 'native-test'));
    const again = await client.next();
    expect(again.result.session.mode).toBe('connected');
  });

  it('turning it off closes the client and removes the endpoint', async () => {
    await setSwitch('agent-access-enabled', false);
    await browser.waitUntil(async () => (await statusText()).includes('Off'), { timeout: 20_000 });
    await browser.waitUntil(
      async () => !readdirSync(RUNTIME as string).some((n) => n.startsWith('v-')),
      { timeout: 20_000, timeoutMsg: 'the instance directory was not removed' },
    );
    await browser.waitUntil(async () => client.closed, {
      timeout: 10_000,
      timeoutMsg: 'the attached client was not disconnected',
    });
    expect(listInstances().filter((i) => i.alive)).toHaveLength(0);
    expect(existsSync(RUNTIME as string)).toBe(true);
    client.destroy();
    // Leave the test profile as a fresh install would have it.
    await setSwitch('agent-access-capture', false);
    await setSwitch('agent-access-edit', false);
  });
});
