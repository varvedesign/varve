/**
 * `varve config mcp`: print the configuration an MCP client needs.
 *
 * Read-only by construction. It writes no file, edits no client's settings and
 * starts no process: registering a server in someone's client is their action,
 * and a setup step that quietly rewrote a config file would be exactly the kind
 * of surprise this tool exists to avoid. What it does is remove the part that
 * goes wrong by hand - the absolute executable path, the interpreter, quoting
 * for a path with spaces - by deriving them from the process that is running.
 *
 * Three separate questions have three separate checks, none of which this
 * command pretends to answer:
 *   1. is the local protocol ready?          `varve doctor`
 *   2. is the intended window reachable?     `varve instances --verify`
 *   3. is it registered in the client?       the client's own server list
 */
import { isAbsolute, resolve } from 'node:path';
import { parseRunArgs, UsageError } from './args';
import type { Io } from './commands';
import { EXIT, type ExitCode } from './exitCodes';

export type ClientKind = 'generic' | 'vscode' | 'claude-code';
const CLIENTS: readonly ClientKind[] = ['generic', 'vscode', 'claude-code'];

const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GRANT = /^(read|edit|view|capture|export|external)$/;

export interface ConfigInputs {
  client: ClientKind;
  /** Absolute path of the interpreter. */
  command: string;
  /** Absolute path of the launcher, followed by `mcp` and its options. */
  args: string[];
  platform: NodeJS.Platform;
}

export interface RenderedConfig {
  client: ClientKind;
  command: string;
  args: string[];
  /** The text to paste or run. JSON clients get JSON; Claude Code a command. */
  snippet: string;
  /** Where the snippet belongs, in words. Nothing here is written for you. */
  placement: string;
  notes: string[];
}

function shellQuote(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return /[\s"&|<>^%]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  }
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function renderConfig(input: ConfigInputs): RenderedConfig {
  const { client, command, args, platform } = input;
  const notes = [
    'This command only prints. Nothing was written and no client was changed.',
    'Registering the server is a separate step that is yours to take.',
    "Readiness is three separate checks: `varve doctor` (the local protocol), `varve instances --verify` (the intended window is reachable), and your client's own server list (it is registered).",
  ];
  if (!isAbsolute(command) || !isAbsolute(args[0] ?? '')) {
    notes.push('A path above is not absolute; the client may not find it from its own directory.');
  }
  if (client === 'claude-code') {
    const line = [
      'claude mcp add varve --',
      ...[command, ...args].map((part) => shellQuote(part, platform)),
    ].join(' ');
    return {
      client,
      command,
      args,
      snippet: line,
      placement:
        'Run this yourself in a terminal. Add `--scope user` or `--scope project` to choose where it is stored.',
      notes,
    };
  }
  const entry = { command, args };
  if (client === 'vscode') {
    return {
      client,
      command,
      args,
      snippet: JSON.stringify({ servers: { varve: { type: 'stdio', ...entry } } }, null, 2),
      placement:
        'Merge the "varve" entry into the "servers" object of .vscode/mcp.json (or your user MCP configuration). Keep any entries already there.',
      notes,
    };
  }
  return {
    client,
    command,
    args,
    snippet: JSON.stringify({ mcpServers: { varve: entry } }, null, 2),
    placement:
      'Merge the "varve" entry into the "mcpServers" object of your client\'s configuration file (Claude Desktop, Cursor and most others use this shape). Keep any entries already there.',
    notes,
  };
}

export async function runConfig(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: ['json'],
    values: ['client', 'instance', 'file', 'new', 'grant', 'require-mode', 'launcher'],
    aliases: { f: 'file' },
  });
  const [topic, ...extra] = a.positionals;
  if (topic !== 'mcp' || extra.length > 0) {
    throw new UsageError('usage: varve config mcp [--client generic|vscode|claude-code] ...');
  }
  const client = (a.value('client') ?? 'generic') as ClientKind;
  if (!CLIENTS.includes(client)) {
    throw new UsageError(`--client must be one of ${CLIENTS.join(', ')}`);
  }

  const target = ['instance', 'file', 'new'].filter((name) => a.has(name));
  if (target.length !== 1) {
    throw new UsageError(
      'choose exactly one of --instance <id> (the running application), --file <document>, or --new <name>',
    );
  }
  const mcpArgs: string[] = ['mcp'];
  if (a.has('instance')) {
    const id = a.value('instance') as string;
    if (!INSTANCE_ID.test(id))
      throw new UsageError('--instance must be an id from `varve instances`');
    mcpArgs.push('--instance', id);
  } else if (a.has('file')) {
    mcpArgs.push('--file', resolve(a.value('file') as string));
  } else {
    mcpArgs.push('--new', a.value('new') as string);
  }
  const grant = a.value('grant');
  if (grant !== undefined) {
    const parts = grant.split(',');
    if (parts.some((part) => !GRANT.test(part))) {
      throw new UsageError(
        '--grant takes a comma-separated list of read, edit, view, capture, export, external',
      );
    }
    mcpArgs.push('--grant', grant);
  }
  const requireMode = a.value('require-mode');
  if (requireMode !== undefined) {
    if (requireMode !== 'headless' && requireMode !== 'connected') {
      throw new UsageError('--require-mode must be "headless" or "connected"');
    }
    mcpArgs.push('--require-mode', requireMode);
  } else if (a.has('instance')) {
    // Pointing a client at the running application must never quietly become
    // an empty headless document if the application is not there.
    mcpArgs.push('--require-mode', 'connected');
  }

  const launcher = a.value('launcher') ?? process.argv[1];
  if (!launcher)
    throw new UsageError("could not determine this program's path; pass --launcher <path>");

  const rendered = renderConfig({
    client,
    command: process.execPath,
    args: [resolve(launcher), ...mcpArgs],
    platform: process.platform,
  });

  if (a.has('json')) {
    io.out(`${JSON.stringify(rendered)}\n`);
  } else {
    io.out(`${rendered.snippet}\n\n${rendered.placement}\n\n`);
    for (const note of rendered.notes) io.err(`note: ${note}\n`);
  }
  return EXIT.OK;
}
