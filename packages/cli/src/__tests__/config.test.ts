import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as ClientV2 } from '@modelcontextprotocol/client';
import { StdioClientTransport as StdioV2 } from '@modelcontextprotocol/client/stdio';
import { createDocument, DocumentCodec } from '@varve/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAutomationCommand } from '../run/commands';
import { renderConfig } from '../run/config';

function capture() {
  let out = '';
  let err = '';
  return {
    io: {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
      readStdin: async () => '',
      env: {},
    },
    out: () => out,
    err: () => err,
  };
}

describe('renderConfig', () => {
  const base = {
    command: '/usr/bin/node',
    args: ['/opt/Varve App/bin/varve.mjs', 'mcp', '--instance', 'window-ab12'],
  };

  it('prints the mcpServers shape most clients use, with the arguments as an array', () => {
    const r = renderConfig({ ...base, client: 'generic', platform: 'linux' });
    expect(JSON.parse(r.snippet)).toEqual({
      mcpServers: { varve: { command: '/usr/bin/node', args: base.args } },
    });
    // A path with a space stays one argument: no shell is involved.
    expect(JSON.parse(r.snippet).mcpServers.varve.args[0]).toBe('/opt/Varve App/bin/varve.mjs');
  });

  it('uses the servers shape, with an explicit stdio type, for VS Code', () => {
    const r = renderConfig({ ...base, client: 'vscode', platform: 'linux' });
    expect(JSON.parse(r.snippet)).toEqual({
      servers: { varve: { type: 'stdio', command: '/usr/bin/node', args: base.args } },
    });
  });

  it('says plainly that it changes nothing and what the three checks are', () => {
    const r = renderConfig({ ...base, client: 'generic', platform: 'linux' });
    expect(r.notes.join(' ')).toContain('Nothing was written');
    expect(r.notes.join(' ')).toContain('varve doctor');
    expect(r.notes.join(' ')).toContain('varve instances --verify');
  });

  it('warns when a path is not absolute rather than printing it silently', () => {
    const r = renderConfig({
      client: 'generic',
      command: 'node',
      args: ['bin/varve.mjs', 'mcp'],
      platform: 'linux',
    });
    expect(r.notes.join(' ')).toContain('not absolute');
  });

  it.each([
    ['/opt/Varve App/bin/varve.mjs'],
    ["/opt/it's here/varve.mjs"],
    ['/opt/a"b/varve.mjs'],
    ['/opt/$HOME/`id`/varve.mjs'],
    ['/opt/semi;colon/varve.mjs'],
  ])('the Claude Code command survives a POSIX shell for %s', (launcher) => {
    const args = [launcher, 'mcp', '--instance', 'window-ab12'];
    const r = renderConfig({
      client: 'claude-code',
      command: '/usr/bin/node',
      args,
      platform: 'linux',
    });
    expect(r.snippet.startsWith('claude mcp add varve -- ')).toBe(true);
    const rest = r.snippet.slice('claude mcp add varve -- '.length);
    // Let a real shell split it, and compare with what we meant to say.
    const shell = spawnSync('sh', ['-c', `for a in ${rest}; do printf '%s\\n' "$a"; done`], {
      encoding: 'utf8',
    });
    expect(shell.stdout.split('\n').slice(0, -1)).toEqual(['/usr/bin/node', ...args]);
  });
});

describe('varve config mcp', () => {
  it('refuses a missing or ambiguous target instead of guessing', async () => {
    for (const argv of [
      ['config', 'mcp'],
      ['config', 'mcp', '--instance', 'window-a', '--file', 'x.varve'],
      ['config', 'mcp', '--instance', '../escape'],
      ['config', 'mcp', '--instance', 'window-a', '--grant', 'root'],
      ['config', 'mcp', '--instance', 'window-a', '--client', 'emacs'],
      ['config', 'mcp', '--instance', 'window-a', '--require-mode', 'maybe'],
      ['config', 'other'],
    ]) {
      const c = capture();
      expect(await runAutomationCommand(c.io, argv), argv.join(' ')).toBe(2);
      expect(c.out()).toBe('');
    }
  });

  it('pins an attached config to the running application, never an empty headless document', async () => {
    const c = capture();
    expect(
      await runAutomationCommand(c.io, [
        'config',
        'mcp',
        '--instance',
        'window-a',
        '--json',
        '--launcher',
        '/x/varve.mjs',
      ]),
    ).toBe(0);
    const out = JSON.parse(c.out());
    expect(out.args).toEqual([
      '/x/varve.mjs',
      'mcp',
      '--instance',
      'window-a',
      '--require-mode',
      'connected',
    ]);
  });

  it("keeps grants out unless asked for, so the default is the server's read-only default", async () => {
    const c = capture();
    await runAutomationCommand(c.io, [
      'config',
      'mcp',
      '--new',
      'Scratch',
      '--json',
      '--launcher',
      '/x/varve.mjs',
    ]);
    expect(JSON.parse(c.out()).args).not.toContain('--grant');
  });
});

// ── The printed configuration actually launches a working server ───────────

const here = dirname(fileURLToPath(import.meta.url));
const buildScript = join(here, '../../scripts/build-bundle.mjs');
let root: string;
let bundle: string;
let doc: string;

beforeAll(() => {
  // A path with a space, and no PATH entry: the way a packaged install is run.
  root = mkdtempSync(join(tmpdir(), 'vcfg '));
  bundle = join(root, 'Varve App', 'bin', 'varve.mjs');
  const built = spawnSync(process.execPath, [buildScript, '--outfile', bundle], {
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`bundle build failed: ${built.stderr}`);
  mkdirSync(join(root, 'My Documents'), { recursive: true });
  doc = join(root, 'My Documents', 'poster design.varve');
  writeFileSync(doc, DocumentCodec.encode(createDocument('Poster')), 'utf8');
}, 180_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function tree(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    found.push(`${full}:${entry.isDirectory() ? 'd' : statSync(full).size}`);
    if (entry.isDirectory()) found.push(...tree(full));
  }
  return found.sort();
}

describe('the packaged bundle', () => {
  it('is a production build, so a development-only diagnostic cannot slow every edit', () => {
    const text = readFileSync(bundle, 'utf8');
    // `devValidate` re-validates the whole document after every operation unless
    // NODE_ENV is "production". The bundle pins it, so no check reads the
    // environment at all.
    expect(text).not.toMatch(/process\.env\.NODE_ENV/);
  });
});

describe('the printed configuration, run for real', () => {
  it('launches a server a real client can use, from a path with spaces and no PATH', async () => {
    const before = tree(root);
    const printed = spawnSync(
      process.execPath,
      [bundle, 'config', 'mcp', '--file', doc, '--grant', 'read', '--json'],
      { encoding: 'utf8', env: { PATH: '' } },
    );
    expect(printed.status).toBe(0);
    // Printing configuration wrote nothing anywhere under the install or documents.
    expect(tree(root)).toEqual(before);

    const config = JSON.parse(printed.stdout) as { command: string; args: string[] };
    expect(config.command).toBe(process.execPath);
    expect(config.args[0]).toBe(bundle);
    expect(config.args).toEqual([bundle, 'mcp', '--file', doc, '--grant', 'read']);

    const client = new ClientV2({ name: 'config-check', version: '1' });
    const transport = new StdioV2({
      command: config.command,
      args: config.args,
      env: { PATH: '' },
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        'varve_batch',
        'varve_describe_command',
        'varve_invoke',
        'varve_query',
        'varve_search_commands',
        'varve_session',
      ]);
      const session = await client.callTool({ name: 'varve_session', arguments: {} });
      expect((session.structuredContent as { mode: string }).mode).toBe('headless');
      const info = await client.callTool({
        name: 'varve_query',
        arguments: { command: 'varve.document.info' },
      });
      expect((info.structuredContent as { outcome: string }).outcome).toBe('ok');
    } finally {
      await client.close();
    }
  }, 90_000);

  it('an attached config fails closed when nothing is running, rather than opening an empty document', async () => {
    const printed = spawnSync(
      process.execPath,
      [bundle, 'config', 'mcp', '--instance', 'window-nothere', '--json'],
      { encoding: 'utf8', env: { PATH: '' } },
    );
    const config = JSON.parse(printed.stdout) as { command: string; args: string[] };
    const run = spawnSync(config.command, config.args, {
      encoding: 'utf8',
      env: { PATH: '', VARVE_RUNTIME_DIR: join(root, 'no-endpoints-here') },
      input: '',
      timeout: 30_000,
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/instance|endpoint|running/i);
  }, 60_000);
});
