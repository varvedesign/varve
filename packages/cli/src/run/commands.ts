/**
 * Automation commands for the CLI: commands, describe, exec, batch, inspect,
 * doctor. Thin: argument handling, file safety, rendering and exit codes. All
 * command semantics live in `@varve/automation`.
 *
 * stdout carries the result (human text, or exactly one JSON document with
 * `--json`). Diagnostics and warnings go to stderr, so a pipeline can trust
 * stdout.
 */
import {
  type BatchReceipt,
  createStandardCatalog,
  parseStrictJson,
  type Receipt,
  utf8ByteLength,
} from '@varve/automation';
import { parseRunArgs, UsageError } from './args';
import { EXIT, type ExitCode } from './exitCodes';
import {
  acquireLock,
  FileError,
  type FileLock,
  PathPolicy,
  sha256File,
  type WriteMode,
  writeTextAtomic,
} from './files';
import { Journal, journalPathFor, reconcile } from './journal';
import { formatCommandTable, formatDescription, formatReceipt } from './output';
import {
  encodeVerified,
  maxDocumentBytes,
  type OpenedSession,
  openFileSession,
  openNewSession,
} from './session';

export interface Io {
  out(text: string): void;
  err(text: string): void;
  readStdin(maxBytes: number): Promise<string>;
  env: Record<string, string | undefined>;
}

export const AUTOMATION_COMMANDS = new Set([
  'commands',
  'describe',
  'exec',
  'batch',
  'inspect',
  'doctor',
  'serve',
  'mcp',
  'instances',
  'config',
]);

const ARGS_LIMIT = 1024 * 1024;

const SAVE_FLAGS = ['json', 'dry-run', 'in-place', 'overwrite'] as const;
const SAVE_VALUES = [
  'file',
  'new',
  'out',
  'idempotency-key',
  'attempt',
  'expect-revision',
  'document-id',
  'read-root',
  'write-root',
] as const;

function toInt(name: string, raw: string | undefined, min: number): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw))
    throw new UsageError(`--${name} must be an integer, got ${JSON.stringify(raw)}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new UsageError(`--${name} must be an integer >= ${min}`);
  }
  return value;
}

export function exitForReceipt(receipt: Receipt | BatchReceipt): ExitCode {
  const code = receipt.error?.code;
  if (receipt.outcome === 'unknown' || code === 'OUTCOME_UNKNOWN') return EXIT.UNKNOWN_OUTCOME;
  if (code === 'REVISION_CONFLICT' || code === 'CONFLICT' || code === 'TARGET_MISMATCH') {
    return EXIT.CONFLICT;
  }
  if (receipt.outcome === 'rejected' || receipt.outcome === 'partial') return EXIT.REJECTED;
  return EXIT.OK;
}

// ── commands / describe ─────────────────────────────────────────────────────

export async function runCommandsList(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, { flags: ['json'], values: ['search', 'effect', 'domain'] });
  if (a.positionals.length > 0) throw new UsageError('commands takes no positional arguments');
  const catalog = createStandardCatalog();
  const query = a.value('search');
  let list = query ? catalog.search(query, { limit: 200 }) : catalog.list();
  const effect = a.value('effect');
  if (effect) list = list.filter((c) => c.effect === effect);
  const domain = a.value('domain');
  if (domain) list = list.filter((c) => c.id.split('.')[1] === domain);
  if (a.flags.has('json')) {
    io.out(`${JSON.stringify({ catalogHash: catalog.catalogHash(), commands: list })}\n`);
  } else {
    io.out(`${formatCommandTable(list)}\n`);
  }
  return EXIT.OK;
}

export async function runDescribe(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, { flags: ['json'] });
  const id = a.positionals[0];
  if (id === undefined || a.positionals.length > 1)
    throw new UsageError('usage: describe <command>');
  const catalog = createStandardCatalog();
  const description = catalog.describe(id);
  if (!description) {
    const near = catalog.suggest(id);
    io.err(`unknown command ${id}${near ? `; did you mean ${near}?` : ''}\n`);
    return EXIT.REJECTED;
  }
  io.out(
    a.flags.has('json')
      ? `${JSON.stringify(description)}\n`
      : `${formatDescription(description)}\n`,
  );
  return EXIT.OK;
}

// ── exec / batch ────────────────────────────────────────────────────────────

interface SaveContext {
  inPlace: boolean;
  out: string | undefined;
  overwrite: boolean;
  json: boolean;
}

function readJsonText(label: string, text: string): unknown {
  const parsed = parseStrictJson(text, { maxBytes: ARGS_LIMIT });
  if (!parsed.ok) {
    throw new UsageError(
      `${label} is not valid JSON: ${parsed.error.message} (at offset ${parsed.error.offset})`,
    );
  }
  return parsed.value;
}

async function readArgsSource(io: Io, a: ReturnType<typeof parseRunArgs>): Promise<unknown> {
  const sources = ['args-json', 'args-file', 'args-stdin'].filter((name) => a.has(name));
  if (sources.length > 1) throw new UsageError(`use only one of --${sources.join(', --')}`);
  if (a.has('args-json')) return readJsonText('--args-json', a.value('args-json') as string);
  if (a.has('args-file')) {
    const path = a.value('args-file') as string;
    const { readFileSync } = await import('node:fs');
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      throw new FileError(
        'READ_FAILED',
        `cannot read --args-file ${path}: ${(error as Error).message}`,
      );
    }
    if (utf8ByteLength(text) > ARGS_LIMIT)
      throw new UsageError(`--args-file exceeds ${ARGS_LIMIT} bytes`);
    return readJsonText(`--args-file ${path}`, text);
  }
  if (a.has('args-stdin')) return readJsonText('stdin', await io.readStdin(ARGS_LIMIT));
  return {};
}

interface Prepared {
  session: OpenedSession;
  lock: FileLock | null;
  journal: Journal | null;
  policy: PathPolicy;
  canonicalSource: string | null;
}

function prepare(io: Io, a: ReturnType<typeof parseRunArgs>, save: SaveContext): Prepared {
  const file = a.value('file');
  const newName = a.value('new');
  if ((file === undefined) === (newName === undefined)) {
    throw new UsageError('give exactly one of --file <document> or --new <name>');
  }
  if (save.inPlace && save.out) throw new UsageError('--in-place and --out are mutually exclusive');
  if (save.inPlace && file === undefined) throw new UsageError('--in-place needs --file');
  if (newName !== undefined && !save.out) {
    throw new UsageError('--new needs --out <file> to say where the document is written');
  }
  const policy = PathPolicy.fromEnv(io.env, {
    readRoots: a.values.get('read-root'),
    writeRoots: a.values.get('write-root'),
  });
  const maxBytes = maxDocumentBytes(io.env);

  if (file === undefined) {
    return {
      session: openNewSession(newName as string),
      lock: null,
      journal: null,
      policy,
      canonicalSource: null,
    };
  }

  const canonicalSource = policy.resolveRead(file);
  let lock: FileLock | null = null;
  if (save.inPlace) {
    policy.resolveWrite(canonicalSource); // enforce write roots before touching anything
    lock = acquireLock(canonicalSource);
  }
  let session: OpenedSession;
  try {
    session = openFileSession(policy, file, maxBytes);
  } catch (error) {
    lock?.release();
    throw error;
  }
  let journal: Journal | null = null;
  const key = a.value('idempotency-key');
  if (save.inPlace && key !== undefined && session.source) {
    journal = new Journal(policy, journalPathFor(canonicalSource));
    const entry = journal
      .load()
      .find((e) => e.key === key && e.principalId === session.principal.id);
    const verdict = reconcile(entry, session.source.contentHash);
    if (verdict.seed) {
      session.idempotency.record({
        ...verdict.seed,
        documentId: session.authority.info().documentId,
      });
    }
  }
  return { session, lock, journal, policy, canonicalSource };
}

async function persist(
  io: Io,
  prepared: Prepared,
  save: SaveContext,
  receipt: Receipt | BatchReceipt,
  key: string | undefined,
): Promise<Receipt | BatchReceipt> {
  const replayed = 'idempotency' in receipt && receipt.idempotency?.replayed === true;
  const mutated = receipt.outcome === 'applied' || receipt.outcome === 'partial';
  if (!mutated || replayed) return receipt;
  if (!save.inPlace && !save.out) {
    io.err(
      'warning: the change was applied in memory only and was NOT saved; pass --out <file> or --in-place\n',
    );
    return receipt;
  }

  const { session, policy } = prepared;
  const text = encodeVerified(session.authority.getDocument());
  const target = save.inPlace ? (prepared.canonicalSource as string) : (save.out as string);
  const beforeHash = session.source?.contentHash ?? '';
  const afterHash = sha256File(text);
  const bytes = utf8ByteLength(text);

  let mode: WriteMode;
  if (save.inPlace) {
    mode = { kind: 'replace-expected', expectedHash: beforeHash };
  } else {
    if (prepared.canonicalSource && policy.resolveWrite(target) === prepared.canonicalSource) {
      throw new FileError(
        'EXISTS',
        `${target} is the source document; use --in-place to modify it deliberately`,
      );
    }
    mode = save.overwrite ? { kind: 'replace-any' } : { kind: 'create-new' };
  }

  const durable = { saved: true, path: target, bytes, contentHash: afterHash };
  const withDurable = { ...receipt, durable } as Receipt | BatchReceipt;
  if (prepared.journal && key !== undefined) {
    prepared.journal.upsert({
      key,
      principalId: session.principal.id,
      documentId: session.authority.info().documentId,
      operation: 'command' in receipt ? receipt.command : 'batch',
      argsHash: ('idempotency' in receipt && receipt.idempotency?.argsHash) || '',
      state: 'pending',
      beforeHash,
      afterHash,
      receipt: withDurable,
      storedAt: Date.now(),
    });
  }
  const saved = writeTextAtomic(policy, target, text, mode);
  if (prepared.journal && key !== undefined) {
    prepared.journal.upsert({
      key,
      principalId: session.principal.id,
      documentId: session.authority.info().documentId,
      operation: 'command' in receipt ? receipt.command : 'batch',
      argsHash: ('idempotency' in receipt && receipt.idempotency?.argsHash) || '',
      state: 'committed',
      beforeHash,
      afterHash,
      receipt: withDurable,
      storedAt: Date.now(),
    });
  }
  return { ...receipt, durable: { ...durable, path: saved.path, bytes: saved.bytes } } as
    | Receipt
    | BatchReceipt;
}

function emit(io: Io, receipt: Receipt | BatchReceipt, json: boolean): void {
  if (json) {
    io.out(`${JSON.stringify(receipt)}\n`);
    return;
  }
  const saved =
    receipt.durable.saved && receipt.durable.path
      ? { path: receipt.durable.path, bytes: receipt.durable.bytes ?? 0 }
      : null;
  io.out(`${formatReceipt(receipt, saved)}\n`);
}

export async function runExec(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: [...SAVE_FLAGS, 'args-stdin'],
    values: [...SAVE_VALUES, 'args-json', 'args-file', 'alias', 'command-version'],
    aliases: { o: 'out', f: 'file' },
  });
  const command = a.positionals[0];
  if (command === undefined || a.positionals.length > 1) {
    throw new UsageError('usage: exec <command> --file <document> [--args-json <json>] [options]');
  }
  const save: SaveContext = {
    inPlace: a.flags.has('in-place'),
    out: a.value('out'),
    overwrite: a.flags.has('overwrite'),
    json: a.flags.has('json'),
  };
  const args = await readArgsSource(io, a);
  const key = a.value('idempotency-key');
  const documentId = a.value('document-id');
  const request: Record<string, unknown> = {
    command,
    args,
    ...(key !== undefined ? { idempotencyKey: key } : {}),
    ...(a.has('attempt') ? { attempt: toInt('attempt', a.value('attempt'), 1) } : {}),
    ...(a.has('expect-revision')
      ? { expectedRevision: toInt('expect-revision', a.value('expect-revision'), 0) }
      : {}),
    ...(a.has('command-version')
      ? { commandVersion: toInt('command-version', a.value('command-version'), 1) }
      : {}),
    ...(a.has('alias') ? { alias: a.value('alias') } : {}),
    ...(a.flags.has('dry-run') ? { dryRun: true } : {}),
    ...(documentId !== undefined ? { target: { documentId } } : {}),
  };

  const prepared = prepare(io, a, save);
  try {
    for (const warning of prepared.session.warnings) io.err(`warning: ${warning}\n`);
    let receipt: Receipt | BatchReceipt = await prepared.session.executor.execute(
      prepared.session.ctx,
      request,
    );
    receipt = await persist(io, prepared, save, receipt, key);
    emit(io, receipt, save.json);
    return exitForReceipt(receipt);
  } finally {
    prepared.lock?.release();
  }
}

export async function runBatch(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: [...SAVE_FLAGS],
    values: [...SAVE_VALUES, 'steps-file', 'mode', 'on-error'],
    aliases: { o: 'out', f: 'file' },
  });
  if (a.positionals.length > 0) throw new UsageError('batch takes options only; see --steps-file');
  const stepsPath = a.value('steps-file');
  if (stepsPath === undefined) throw new UsageError('batch needs --steps-file <path|->');
  let text: string;
  if (stepsPath === '-') {
    text = await io.readStdin(ARGS_LIMIT);
  } else {
    const { readFileSync } = await import('node:fs');
    try {
      text = readFileSync(stepsPath, 'utf8');
    } catch (error) {
      throw new FileError('READ_FAILED', `cannot read ${stepsPath}: ${(error as Error).message}`);
    }
  }
  const body = readJsonText(stepsPath === '-' ? 'stdin' : stepsPath, text);
  const base: Record<string, unknown> = Array.isArray(body)
    ? { steps: body }
    : (body as Record<string, unknown>);
  if (typeof base !== 'object' || base === null) {
    throw new UsageError('the steps file must be an array of steps or an object with "steps"');
  }
  const mode = a.value('mode');
  const onError = a.value('on-error');
  const key = a.value('idempotency-key');
  const request: Record<string, unknown> = {
    ...base,
    ...(mode !== undefined ? { mode } : {}),
    ...(onError !== undefined ? { onError } : {}),
    ...(key !== undefined ? { idempotencyKey: key } : {}),
    ...(a.has('attempt') ? { attempt: toInt('attempt', a.value('attempt'), 1) } : {}),
    ...(a.has('expect-revision')
      ? { expectedRevision: toInt('expect-revision', a.value('expect-revision'), 0) }
      : {}),
    ...(a.flags.has('dry-run') ? { dryRun: true } : {}),
    ...(a.has('document-id') ? { target: { documentId: a.value('document-id') } } : {}),
  };
  const save: SaveContext = {
    inPlace: a.flags.has('in-place'),
    out: a.value('out'),
    overwrite: a.flags.has('overwrite'),
    json: a.flags.has('json'),
  };
  const prepared = prepare(io, a, save);
  try {
    for (const warning of prepared.session.warnings) io.err(`warning: ${warning}\n`);
    let receipt: Receipt | BatchReceipt = await prepared.session.executor.executeBatch(
      prepared.session.ctx,
      request,
    );
    receipt = await persist(io, prepared, save, receipt, key);
    emit(io, receipt, save.json);
    return exitForReceipt(receipt);
  } finally {
    prepared.lock?.release();
  }
}

// ── inspect ─────────────────────────────────────────────────────────────────

interface TreeNode {
  id: string;
  kind: string;
  name: string;
  childCount?: number;
  visible: boolean;
  locked: boolean;
}

export async function runInspect(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: ['json'],
    values: ['file', 'depth', 'read-root'],
    aliases: { f: 'file' },
  });
  const file = a.value('file');
  if (file === undefined) throw new UsageError('inspect needs --file <document>');
  const depth = toInt('depth', a.value('depth'), 0) ?? 3;
  const policy = PathPolicy.fromEnv(io.env, { readRoots: a.values.get('read-root') });
  const session = openFileSession(policy, file, maxDocumentBytes(io.env));
  for (const warning of session.warnings) io.err(`warning: ${warning}\n`);

  const info = await session.executor.execute(session.ctx, { command: 'varve.document.info' });
  const lines: string[] = [];
  const tree: unknown[] = [];

  const walk = async (parentId: string | null, level: number, into: unknown[]): Promise<void> => {
    let cursor: string | undefined;
    do {
      const page = await session.executor.execute(session.ctx, {
        command: 'varve.node.list',
        args: { parentId, limit: 500, ...(cursor ? { cursor } : {}) },
      });
      const out = page.output as { nodes: TreeNode[]; nextCursor?: string };
      for (const node of out.nodes) {
        const mark = `${node.locked ? ' [locked]' : ''}${node.visible ? '' : ' [hidden]'}`;
        lines.push(
          `${'  '.repeat(level)}${node.name || '(unnamed)'}  ${node.kind}  ${node.id}${mark}`,
        );
        const entry: Record<string, unknown> = { ...node };
        into.push(entry);
        if ((node.childCount ?? 0) > 0 && level < depth) {
          const children: unknown[] = [];
          entry.children = children;
          await walk(node.id, level + 1, children);
        }
      }
      cursor = out.nextCursor;
    } while (cursor);
  };

  const rootInfo = info.output as { defaultParentId: string | null };
  await walk(rootInfo.defaultParentId, 0, tree);
  if (a.flags.has('json')) {
    io.out(`${JSON.stringify({ document: info.output, tree })}\n`);
  } else {
    const doc = info.output as {
      name: string;
      documentId: string;
      revision: number;
      nodeCount: number;
    };
    io.out(`${doc.name}  (${doc.documentId}, ${doc.nodeCount} nodes)\n${lines.join('\n')}\n`);
  }
  return EXIT.OK;
}

// ── doctor ──────────────────────────────────────────────────────────────────

export async function runDoctor(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, { flags: ['json'] });
  if (a.positionals.length > 0) throw new UsageError('doctor takes no positional arguments');
  const catalog = createStandardCatalog();
  const policy = PathPolicy.fromEnv(io.env);
  const report = {
    cli: 'varve cli 0.0.0',
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    catalog: { commands: catalog.size, hash: catalog.catalogHash() },
    runtimes: { headless: true, connected: false },
    connected: {
      available: false,
      reason: 'no automation listener is implemented in the desktop app yet',
    },
    paths: policy.describe(),
    limits: { maxDocumentBytes: maxDocumentBytes(io.env), maxArgumentBytes: ARGS_LIMIT },
  };
  if (a.flags.has('json')) {
    io.out(`${JSON.stringify(report)}\n`);
  } else {
    io.out(
      [
        report.cli,
        `node:       ${report.node} (${report.platform})`,
        `commands:   ${report.catalog.commands} (catalog ${report.catalog.hash})`,
        'headless:   available',
        `connected:  not available (${report.connected.reason})`,
        `read roots: ${report.paths.readRoots?.join(', ') ?? 'unrestricted'}`,
        `write roots:${report.paths.writeRoots ? ` ${report.paths.writeRoots.join(', ')}` : ' unrestricted'}`,
      ]
        .join('\n')
        .concat('\n'),
    );
  }
  return EXIT.OK;
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function runAutomationCommand(io: Io, argv: string[]): Promise<ExitCode> {
  const [name, ...rest] = argv;
  try {
    switch (name) {
      case 'commands':
        return await runCommandsList(io, rest);
      case 'describe':
        return await runDescribe(io, rest);
      case 'exec':
        return await runExec(io, rest);
      case 'batch':
        return await runBatch(io, rest);
      case 'inspect':
        return await runInspect(io, rest);
      case 'doctor':
        return await runDoctor(io, rest);
      case 'serve': {
        const { runServe } = await import('./serve');
        return await runServe(io, rest);
      }
      case 'instances': {
        const { runInstances } = await import('./serve');
        return await runInstances(io, rest);
      }
      case 'mcp': {
        const { runMcp } = await import('./mcp');
        return await runMcp(io, rest);
      }
      case 'config': {
        const { runConfig } = await import('./config');
        return await runConfig(io, rest);
      }
      default:
        io.err(`unknown command: ${name}\n`);
        return EXIT.USAGE;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`varve ${name}: ${error.message}\n`);
      return EXIT.USAGE;
    }
    if (error instanceof FileError) {
      io.err(`varve ${name}: ${error.message}\n`);
      return error.code === 'CHANGED_ON_DISK' || error.code === 'LOCKED' ? EXIT.CONFLICT : EXIT.IO;
    }
    io.err(`varve ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.IO;
  }
}
