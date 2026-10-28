#!/usr/bin/env node
/**
 * Regression tests for the Rust <-> TypeScript IPC contract audit.
 *
 * Fixtures build a minimal Tauri-shaped tree in a temp directory. The real
 * repository is never mutated, and the tests inject their own allowlists so the
 * known pre-existing native gaps do not make them pass vacuously.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeIpcContract, parseInvokeSites, parseRustCommands } from './audit-ipc-contract.mjs';

const scriptPath = fileURLToPath(new URL('./audit-ipc-contract.mjs', import.meta.url));
const RUST_DIR = 'apps/desktop/src-tauri/src';
const BACKTICK = String.fromCharCode(96);

function makeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'audit-ipc-'));
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function runCli(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: error.status ?? 1,
      output: String(error.stdout ?? '') + String(error.stderr ?? ''),
    };
  }
}

function withFixture(files, body) {
  const root = makeFixture(files);
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rustFile(commands, { handler = true } = {}) {
  const parts = ['use tauri;', ''];
  for (const command of commands) parts.push(command.body, '');
  if (handler) {
    parts.push(
      'fn build() {',
      '    tauri::Builder::default().invoke_handler(tauri::generate_handler![',
    );
    for (const command of commands) parts.push('        ' + command.name + ',');
    parts.push('    ]);', '}');
  }
  return parts.join('\n') + '\n';
}

function command(name, { visibility = '', asyncKeyword = '', attributes = [] } = {}) {
  return {
    name,
    body: [
      '#[tauri::command]',
      ...attributes,
      visibility + asyncKeyword + 'fn ' + name + '() -> Result<(), String> {',
      '    Ok(())',
      '}',
    ].join('\n'),
  };
}

const PLAIN_RUST = rustFile([
  command('plain_command'),
  command('async_command', { visibility: 'pub ', asyncKeyword: 'async ' }),
  command('pub_crate_command', { visibility: 'pub(crate) ' }),
]);

test('clean fixture passes and parses all command shapes', () => {
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/engine/src/example.ts': [
        'declare const core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };',
        'export async function run() {',
        "  await core.invoke('plain_command', { value: 'x' });",
        "  await core.invoke<{ ok: boolean }>('async_command', {});",
        '  await core.invoke(',
        "    'pub_crate_command',",
        '    {},',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
    (root) => {
      const result = analyzeIpcContract({ root, knownNativeGaps: new Map() });
      assert.deepEqual(result.rustCommands.map((entry) => entry.name).sort(), [
        'async_command',
        'plain_command',
        'pub_crate_command',
      ]);
      assert.equal(result.literals.length, 3);
      assert.equal(result.missingLiterals.length, 0);
      assert.equal(result.problems.length, 0, JSON.stringify(result.problems));
      const cli = runCli(root);
      assert.equal(cli.status, 0, cli.output);
      assert.match(cli.output, /IPC contract OK: 3 Rust commands/);
    },
  );
});

test('comment mention of the attribute is not parsed as a command', () => {
  const text = [
    'use tauri;',
    '',
    '/// Marks #[tauri::command] functions that call std::fs directly.',
    'pub fn helper() {}',
    '',
    '#[tauri::command]',
    'fn real_command() -> Result<(), String> { Ok(()) }',
    '',
  ].join('\n');
  const parsed = parseRustCommands(text, 'lib.rs');
  assert.deepEqual(
    parsed.commands.map((entry) => entry.name),
    ['real_command'],
  );
  assert.equal(parsed.skipped, 0);
});

test('multiline attributes, rename_all and interleaved attributes are tolerated', () => {
  const text = [
    '#[tauri::command(',
    '    rename_all = "camelCase",',
    ')]',
    '#[allow(clippy::too_many_arguments)]',
    '/// doc comment between attributes and fn',
    'pub(crate) async fn multiline_command(',
    '    app: tauri::AppHandle,',
    ') -> Result<(), String> {',
    '    Ok(())',
    '}',
  ].join('\n');
  const parsed = parseRustCommands(text, 'lib.rs');
  assert.deepEqual(
    parsed.commands.map((entry) => entry.name),
    ['multiline_command'],
  );
});

test('an unknown literal invoke fails with the command name and site', () => {
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/engine/src/broken.ts':
        "export const run = (core: any) => core.invoke('ghost_command', {});\n",
    },
    (root) => {
      const cli = runCli(root);
      assert.equal(cli.status, 1, cli.output);
      assert.match(cli.output, /ghost_command/);
      assert.match(cli.output, /names no Rust #\[tauri::command\]/);
      assert.match(cli.output, /packages\/engine\/src\/broken\.ts:1/);
    },
  );
});

test('a template-literal first argument is dynamic, not a literal command', () => {
  const source =
    'export const run = (core: any) => core.invoke(' +
    BACKTICK +
    'ghost_template' +
    BACKTICK +
    ', {});\n';
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/engine/src/dynamic.ts': source,
    },
    (root) => {
      const parsed = parseInvokeSites(source, 'packages/engine/src/dynamic.ts');
      assert.equal(parsed.literals.length, 0);
      assert.equal(parsed.dynamics.length, 1);
      const cli = runCli(root);
      assert.equal(cli.status, 1, cli.output);
      assert.match(cli.output, /dynamic invoke/);
      assert.match(cli.output, /not allowlisted/);
    },
  );
});

test('dynamic call sites pass only when allowlisted with a site budget', () => {
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/engine/src/dynamic.ts':
        'export const run = (core: any, cmd: string) => core.invoke(cmd, {});\n',
    },
    (root) => {
      const blocked = analyzeIpcContract({ root, knownNativeGaps: new Map() });
      assert.equal(blocked.problems.length, 1);
      assert.match(blocked.problems[0].message, /not allowlisted/);
      const allowed = analyzeIpcContract({
        root,
        knownNativeGaps: new Map(),
        dynamicAllowlist: new Map([
          ['packages/engine/src/dynamic.ts', { maxSites: 1, reason: 'fixture transport' }],
        ]),
      });
      assert.equal(allowed.problems.length, 0, JSON.stringify(allowed.problems));
      writeFileSync(
        join(root, 'packages/engine/src/dynamic.ts'),
        'export const run = (core: any, a: string, b: string) => Promise.all([core.invoke(a), core.invoke(b)]);\n',
      );
      const overBudget = analyzeIpcContract({
        root,
        knownNativeGaps: new Map(),
        dynamicAllowlist: new Map([
          ['packages/engine/src/dynamic.ts', { maxSites: 1, reason: 'fixture transport' }],
        ]),
      });
      assert.equal(overBudget.problems.length, 1);
      assert.match(overBudget.problems[0].message, /allowlist maxSites is 1/);
    },
  );
});

test('known native gaps pass while listed and fail when Rust resolves them', () => {
  const gapName = 'home_list_folders';
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/platform/src/tauri.ts':
        "export const listFolders = (core: any) => core.invoke('" + gapName + "');\n",
    },
    (root) => {
      const gaps = new Map([[gapName, 'fixture gap']]);
      const result = analyzeIpcContract({ root, knownNativeGaps: gaps });
      assert.equal(result.missingLiterals.length, 0);
      assert.deepEqual(result.knownGapNames, [gapName]);
      assert.equal(result.problems.length, 0, JSON.stringify(result.problems));
      writeFileSync(
        join(root, RUST_DIR, 'lib.rs'),
        rustFile([command('plain_command'), command(gapName)]),
      );
      const stale = analyzeIpcContract({ root, knownNativeGaps: gaps });
      assert.equal(stale.problems.length, 1);
      assert.match(stale.problems[0].message, /stale KNOWN_NATIVE_GAPS entry/);
      assert.match(stale.problems[0].message, /remove the allowlist entry/);
    },
  );
});

test('plugin-namespaced invokes and interface declarations are ignored', () => {
  const declarationFile = [
    'interface TauriCore {',
    '  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;',
    '}',
    'interface TauriCoreMultiline {',
    '  invoke(',
    '    cmd: string,',
    '    args?: Record<string, unknown>,',
    '  ): Promise<unknown>;',
    '}',
    "export const open = (core: TauriCore) => core.invoke('plugin:dialog|open');",
    "export const hit = (core: TauriCore) => core.invoke('plain_command');",
    '',
  ].join('\n');
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: PLAIN_RUST,
      'packages/platform/src/tauri.ts': declarationFile,
    },
    (root) => {
      const result = analyzeIpcContract({ root, knownNativeGaps: new Map() });
      assert.equal(result.declarations.length, 2);
      assert.equal(result.dynamics.length, 0, JSON.stringify(result.dynamics));
      assert.equal(result.problems.length, 0, JSON.stringify(result.problems));
    },
  );
});

test('invoking a defined-but-unregistered Rust command fails', () => {
  const hidden = command('hidden_command');
  withFixture(
    {
      [RUST_DIR + '/lib.rs']: rustFile([command('plain_command'), hidden]).replace(
        '        hidden_command,\n',
        '',
      ),
      'packages/engine/src/call.ts':
        "export const a = (core: any) => core.invoke('plain_command');\n" +
        "export const b = (core: any) => core.invoke('hidden_command');\n",
    },
    (root) => {
      const result = analyzeIpcContract({ root, knownNativeGaps: new Map() });
      assert.deepEqual(result.definedUnregistered, ['hidden_command']);
      assert.equal(result.problems.length, 1);
      assert.match(result.problems[0].message, /does not register/);
    },
  );
});

test('unknown arguments are rejected', () => {
  withFixture({ [RUST_DIR + '/lib.rs']: PLAIN_RUST }, (root) => {
    const result = runCli(root, ['--bogus']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /Unknown argument/);
  });
});
