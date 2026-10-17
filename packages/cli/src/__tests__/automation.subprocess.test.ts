/**
 * Real-process tests for the automation commands.
 *
 * These build the packaged bundle once and run it with `node` as a separate
 * process, from a directory whose path contains spaces, with an empty PATH.
 * Nothing here imports the CLI as a library, so they exercise exactly what an
 * installed `varve` would: argument parsing, stdin, exit codes, stdout/stderr
 * separation, file safety and the on-disk result.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addNode, createDocument, DocumentCodec, makeShapeNode } from '@varve/scene';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const buildScript = join(here, '../../scripts/build-bundle.mjs');

let root: string;
let bundle: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'varve cli e2e '));
  bundle = join(root, 'install dir', 'varve.mjs');
  const built = spawnSync(process.execPath, [buildScript, '--outfile', bundle], {
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`bundle build failed: ${built.stderr}`);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  json<T = Record<string, unknown>>(): T;
}

function varve(
  args: string[],
  options: { input?: string; env?: Record<string, string> } = {},
): Run {
  const result = spawnSync(process.execPath, [bundle, ...args], {
    encoding: 'utf8',
    input: options.input,
    cwd: root,
    env: { PATH: '', ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json<T>() {
      return JSON.parse(result.stdout) as T;
    },
  };
}

let counter = 0;
function workDir(): string {
  counter += 1;
  const dir = join(root, `work ${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function flatDoc(dir: string, name = 'doc.varve', rects = 1): string {
  let doc = { ...createDocument('Fixture', { flat: true }), id: 'fixture-doc' };
  for (let i = 0; i < rects; i++) {
    const node = makeShapeNode(
      `n${i}_aaaa${i.toString(16).padStart(4, '0')}`,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: `Rect ${i}` },
    );
    doc = addNode(doc, node);
  }
  const path = join(dir, name);
  writeFileSync(path, DocumentCodec.encode({ ...doc, nextId: rects + 1 }), 'utf8');
  return path;
}

const createRect = JSON.stringify({ kind: 'rect', x: -50, y: 20.5, width: 120, height: 80 });

describe('discovery', () => {
  it('lists the catalog as one JSON document with a drift hash', () => {
    const r = varve(['commands', '--json']);
    expect(r.status).toBe(0);
    const out = r.json<{ catalogHash: string; commands: Array<{ id: string }> }>();
    expect(out.catalogHash).toMatch(/^[0-9a-f]{16}$/);
    expect(out.commands.map((c) => c.id)).toContain('varve.node.create');
    expect(r.stderr).toBe('');
  });

  it('searches offline by words in the title or summary', () => {
    const r = varve(['commands', '--search', 'rectangle', '--json']);
    const ids = r.json<{ commands: Array<{ id: string }> }>().commands.map((c) => c.id);
    expect(ids).toContain('varve.node.create');
  });

  it('describes a command with a schema and a runnable example', () => {
    const human = varve(['describe', 'varve.node.create']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('arguments:');
    expect(human.stdout).toContain('varve exec varve.node.create');
    const machine = varve(['describe', 'varve.node.create', '--json']).json<{
      inputSchema: { oneOf: unknown[] };
      schemaHash: string;
    }>();
    expect(machine.schemaHash).toMatch(/^[0-9a-f]{16}$/);
    expect(machine.inputSchema.oneOf.length).toBe(4);
  });

  it('reports an unknown command with a suggestion', () => {
    const r = varve(['describe', 'varve.node.creat']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('varve.node.create');
  });
});

describe('exec: results, files and exit codes', () => {
  it('reads without writing and prints exactly one JSON document', () => {
    const doc = flatDoc(workDir());
    const r = varve(['exec', 'varve.document.info', '--file', doc, '--json']);
    expect(r.status).toBe(0);
    const receipt = r.json<{
      outcome: string;
      output: { nodeCount: number };
      target: { mode: string };
    }>();
    expect(receipt.outcome).toBe('ok');
    expect(receipt.output.nodeCount).toBe(1);
    expect(receipt.target.mode).toBe('headless');
  });

  it('creates a node, writes a new file, and the receipt matches the bytes on disk', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const out = join(dir, 'result.varve');
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--out',
      out,
      '--json',
    ]);
    expect(r.status).toBe(0);
    const receipt = r.json<{
      outcome: string;
      created: string[];
      durable: { saved: boolean; path: string; bytes: number; contentHash: string };
    }>();
    expect(receipt.outcome).toBe('applied');
    expect(receipt.durable.saved).toBe(true);
    expect(receipt.durable.path).toBe(out);
    const written = readFileSync(out);
    expect(written.byteLength).toBe(receipt.durable.bytes);
    // Source is untouched; result decodes and contains the new node at the right place.
    const decoded = DocumentCodec.decode(written.toString('utf8'));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const node = decoded.document.nodes[receipt.created[0] as string] as unknown as {
        transform: number[];
      };
      expect([node.transform[4], node.transform[5]]).toEqual([-50, 20.5]);
    }
    const source = DocumentCodec.decode(readFileSync(doc, 'utf8'));
    expect(source.ok && Object.keys(source.document.nodes)).toHaveLength(1);
  });

  it('does not claim a save when nothing was written, and says so on stderr', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const before = readFileSync(doc);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--json',
    ]);
    expect(r.status).toBe(0);
    expect(r.json<{ outcome: string; durable: { saved: boolean } }>().durable.saved).toBe(false);
    expect(r.stderr).toContain('NOT saved');
    expect(readFileSync(doc).equals(before)).toBe(true);
  });

  it('refuses an unknown argument with a nonzero exit and a field-level issue', () => {
    const doc = flatDoc(workDir());
    const bad = JSON.stringify({ kind: 'rect', x: 0, y: 0, width: 5, height: 5, cornerRadious: 2 });
    const r = varve(['exec', 'varve.node.create', '--file', doc, '--args-json', bad, '--json']);
    expect(r.status).toBe(1);
    const receipt = r.json<{
      outcome: string;
      error: { code: string; issues: Array<{ path: string; hint?: string }> };
    }>();
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.error.issues[0]?.path).toBe('/cornerRadious');
    expect(receipt.error.issues[0]?.hint).toContain('cornerRadius');
  });

  it('accepts arguments from stdin with multilingual text', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const out = join(dir, 'text.varve');
    const args = JSON.stringify({
      kind: 'text',
      x: 0,
      y: 0,
      text: '日本語 \u{1F600} Ünïcödé\nsecond line',
    });
    const r = varve(
      ['exec', 'varve.node.create', '--file', doc, '--args-stdin', '--out', out, '--json'],
      { input: args },
    );
    expect(r.status).toBe(0);
    const id = r.json<{ created: string[] }>().created[0] as string;
    const decoded = DocumentCodec.decode(readFileSync(out, 'utf8'));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect((decoded.document.nodes[id] as unknown as { text: string }).text).toBe(
        '日本語 \u{1F600} Ünïcödé\nsecond line',
      );
    }
  });

  it('accepts arguments from a file whose path has spaces', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const argsFile = join(dir, 'my args.json');
    writeFileSync(argsFile, createRect, 'utf8');
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-file',
      argsFile,
      '--json',
    ]);
    expect(r.status).toBe(0);
  });

  it('rejects duplicate JSON keys instead of silently taking the last', () => {
    const doc = flatDoc(workDir());
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      '{"kind":"rect","x":0,"x":5,"y":0,"width":1,"height":1}',
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('duplicate key');
  });

  it('treats negative numbers as values, not options, and ends options at --', () => {
    const doc = flatDoc(workDir());
    const r = varve(['exec', 'varve.document.info', '--file', doc, '--json', '--', '-5']);
    expect(r.status).toBe(2); // extra positional is a usage error, not an unknown option
    expect(r.stderr).toContain('usage');
  });

  it('reports an unknown option with a suggestion', () => {
    const doc = flatDoc(workDir());
    const r = varve(['exec', 'varve.document.info', '--file', doc, '--jsno']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--json');
  });

  it('supports dry runs that change nothing', () => {
    const doc = flatDoc(workDir());
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--dry-run',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const receipt = r.json<{ outcome: string; created: string[] }>();
    expect(receipt.outcome).toBe('preview');
    expect(receipt.created).toHaveLength(1);
    expect(r.stderr).not.toContain('NOT saved');
  });

  it('keeps stdout clean when a document has warnings', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const r = varve(['exec', 'varve.document.info', '--file', doc, '--json']);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe('file safety', () => {
  it('refuses to overwrite an existing output without --overwrite', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const out = join(dir, 'existing.varve');
    writeFileSync(out, 'precious', 'utf8');
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--out',
      out,
    ]);
    expect(r.status).toBe(3);
    expect(readFileSync(out, 'utf8')).toBe('precious');
  });

  it('refuses --out that names the source, pointing at --in-place', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const before = readFileSync(doc);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--out',
      doc,
      '--overwrite',
    ]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('--in-place');
    expect(readFileSync(doc).equals(before)).toBe(true);
  });

  it('replaces the source atomically with --in-place', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--json',
    ]);
    expect(r.status).toBe(0);
    const decoded = DocumentCodec.decode(readFileSync(doc, 'utf8'));
    expect(decoded.ok && Object.keys(decoded.document.nodes)).toHaveLength(2);
    expect(existsSync(`${doc}.varve-lock`)).toBe(false);
    expect(readFileSync(dir === '' ? doc : doc).byteLength).toBeGreaterThan(0);
  });

  it('never removes a lock it did not create and leaves the document untouched', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const before = readFileSync(doc);
    writeFileSync(`${doc}.varve-lock`, JSON.stringify({ pid: 1, host: 'other', tool: 'editor' }));
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
    ]);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('locked');
    expect(existsSync(`${doc}.varve-lock`)).toBe(true);
    expect(readFileSync(doc).equals(before)).toBe(true);
  });

  it('confines writes to the configured roots, including through symlinks and ..', () => {
    const dir = workDir();
    const allowed = join(dir, 'allowed');
    const outside = join(dir, 'outside');
    mkdirSync(allowed);
    mkdirSync(outside);
    const doc = flatDoc(dir);
    const run = (out: string) =>
      varve([
        'exec',
        'varve.node.create',
        '--file',
        doc,
        '--args-json',
        createRect,
        '--out',
        out,
        '--write-root',
        allowed,
      ]);

    expect(run(join(allowed, 'ok.varve')).status).toBe(0);
    expect(run(join(outside, 'no.varve')).status).toBe(3);
    expect(run(join(allowed, '..', 'outside', 'no.varve')).status).toBe(3);

    symlinkSync(outside, join(allowed, 'link'));
    expect(run(join(allowed, 'link', 'escape.varve')).status).toBe(3);
    expect(existsSync(join(outside, 'escape.varve'))).toBe(false);
  });

  it('refuses to replace a hard-linked document, which would alter an alias', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const alias = join(dir, 'alias.varve');
    linkSync(doc, alias);
    const before = readFileSync(alias);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
    ]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('hard link');
    expect(readFileSync(alias).equals(before)).toBe(true);
  });

  it('refuses to write through a symlinked target', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const real = join(dir, 'real.varve');
    writeFileSync(real, 'x', 'utf8');
    const link = join(dir, 'link.varve');
    symlinkSync(real, link);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--out',
      link,
      '--overwrite',
    ]);
    expect(r.status).toBe(3);
    expect(readFileSync(real, 'utf8')).toBe('x');
  });
});

describe('retry safety across processes', () => {
  const key = 'retry-key-1';

  it('replays the original result for a retry and does not edit twice', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const first = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--json',
    ]);
    expect(first.status).toBe(0);
    const created = first.json<{ created: string[] }>().created;
    const bytes = readFileSync(doc);

    const retry = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--attempt',
      '2',
      '--json',
    ]);
    expect(retry.status).toBe(0);
    const replay = retry.json<{ created: string[]; idempotency: { replayed: boolean } }>();
    expect(replay.idempotency.replayed).toBe(true);
    expect(replay.created).toEqual(created);
    expect(readFileSync(doc).equals(bytes)).toBe(true);
  });

  it('reconciles a crash between "pending" and "committed" when the write had landed', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const first = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--json',
    ]);
    expect(first.status).toBe(0);
    const journalPath = `${doc}.varve-journal.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ state: string }>;
    };
    (journal.entries[0] as { state: string }).state = 'pending';
    writeFileSync(journalPath, JSON.stringify(journal));
    const bytes = readFileSync(doc);

    const retry = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--attempt',
      '2',
      '--json',
    ]);
    expect(retry.status).toBe(0);
    expect(retry.json<{ idempotency: { replayed: boolean } }>().idempotency.replayed).toBe(true);
    expect(readFileSync(doc).equals(bytes)).toBe(true);
  });

  it('reports an unknown outcome, and changes nothing, when the document diverged', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--json',
    ]);
    const journalPath = `${doc}.varve-journal.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ state: string }>;
    };
    (journal.entries[0] as { state: string }).state = 'pending';
    writeFileSync(journalPath, JSON.stringify(journal));
    // Someone else edits the document before the retry.
    varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--json',
    ]);
    const bytes = readFileSync(doc);

    const retry = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      key,
      '--attempt',
      '2',
      '--json',
    ]);
    expect(retry.status).toBe(4);
    expect(retry.json<{ outcome: string }>().outcome).toBe('unknown');
    expect(readFileSync(doc).equals(bytes)).toBe(true);
  });

  it('reports an unknown outcome for a declared retry with no record at all', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const bytes = readFileSync(doc);
    const r = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      createRect,
      '--in-place',
      '--idempotency-key',
      'never-sent',
      '--attempt',
      '2',
      '--json',
    ]);
    expect(r.status).toBe(4);
    expect(readFileSync(doc).equals(bytes)).toBe(true);
  });
});

describe('batch and inspect', () => {
  it('applies an atomic batch with $ref ids as one transaction and saves once', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const out = join(dir, 'batch.varve');
    const steps = JSON.stringify([
      {
        command: 'varve.node.create',
        alias: 'box',
        args: { kind: 'frame', x: 0, y: 0, width: 300, height: 200 },
      },
      {
        command: 'varve.node.create',
        args: {
          kind: 'rect',
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          parentId: { $ref: 'box#/created/0' },
        },
      },
    ]);
    const r = varve(['batch', '--file', doc, '--steps-file', '-', '--out', out, '--json'], {
      input: steps,
    });
    expect(r.status).toBe(0);
    const receipt = r.json<{ outcome: string; created: string[]; mode: string }>();
    expect(receipt.mode).toBe('atomic');
    expect(receipt.outcome).toBe('applied');
    expect(receipt.created).toHaveLength(2);
  });

  it('leaves the file alone when a batch step fails', () => {
    const dir = workDir();
    const doc = flatDoc(dir);
    const before = readFileSync(doc);
    const steps = JSON.stringify([
      { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 } },
      { command: 'varve.node.delete', args: { nodeIds: ['ghost'] } },
    ]);
    const r = varve(['batch', '--file', doc, '--steps-file', '-', '--in-place', '--json'], {
      input: steps,
    });
    expect(r.status).toBe(1);
    expect(readFileSync(doc).equals(before)).toBe(true);
  });

  it('prints a tree and does not truncate large output', () => {
    const dir = workDir();
    const doc = flatDoc(dir, 'big.varve', 2000);
    const r = varve(['inspect', '--file', doc, '--json']);
    expect(r.status).toBe(0);
    const parsed = r.json<{ tree: unknown[] }>();
    expect(parsed.tree).toHaveLength(2000);
    expect(r.stdout.length).toBeGreaterThan(200_000);
    const text = varve(['inspect', '--file', doc]);
    expect(text.stdout).toContain('Rect 1999');
  });
});

describe('structure commands in the packaged CLI', () => {
  it('lists, describes, groups and ungroups', () => {
    const listed = varve(['commands', '--json']).json<{ commands: Array<{ id: string }> }>();
    expect(listed.commands.map((c) => c.id)).toEqual(
      expect.arrayContaining(['varve.node.group', 'varve.node.ungroup']),
    );
    const described = varve(['describe', 'varve.node.group']);
    expect(described.status).toBe(0);
    expect(described.stdout).toContain('nodeIds');

    const dir = workDir();
    const doc = flatDoc(dir, 'pair.varve', 2);
    const grouped = join(dir, 'grouped.varve');
    const g = varve([
      'exec',
      'varve.node.group',
      '--file',
      doc,
      '--args-json',
      JSON.stringify({ nodeIds: ['n0_aaaa0000', 'n1_aaaa0001'], name: 'Pair' }),
      '--out',
      grouped,
      '--json',
    ]);
    expect(g.status).toBe(0);
    const receipt = g.json<{ outcome: string; created: string[] }>();
    expect(receipt.outcome).toBe('applied');
    expect(receipt.created).toHaveLength(1);

    const inspected = varve(['inspect', '--file', grouped]);
    expect(inspected.stdout).toContain('Pair');

    const ungrouped = varve([
      'exec',
      'varve.node.ungroup',
      '--file',
      grouped,
      '--args-json',
      JSON.stringify({ nodeId: receipt.created[0] }),
      '--in-place',
      '--json',
    ]);
    expect(ungrouped.status).toBe(0);
    expect(ungrouped.json<{ outcome: string }>().outcome).toBe('applied');
    expect(varve(['inspect', '--file', grouped]).stdout).not.toContain('Pair');
  });

  it('refuses mixed parents with the reason, and leaves the file alone', () => {
    const dir = workDir();
    const doc = flatDoc(dir, 'mixed.varve', 2);
    const before = readFileSync(doc);
    const frame = varve([
      'exec',
      'varve.node.create',
      '--file',
      doc,
      '--args-json',
      JSON.stringify({ kind: 'frame', x: 0, y: 0, width: 100, height: 100 }),
      '--in-place',
      '--json',
    ]);
    const frameId = frame.json<{ created: string[] }>().created[0];
    varve([
      'exec',
      'varve.node.reparent',
      '--file',
      doc,
      '--args-json',
      JSON.stringify({ nodeId: 'n0_aaaa0000', parentId: frameId }),
      '--in-place',
      '--json',
    ]);
    const mid = readFileSync(doc);
    expect(mid.equals(before)).toBe(false);
    const r = varve([
      'exec',
      'varve.node.group',
      '--file',
      doc,
      '--args-json',
      JSON.stringify({ nodeIds: ['n0_aaaa0000', 'n1_aaaa0001'] }),
      '--in-place',
      '--json',
    ]);
    expect(r.status).toBe(1);
    expect(r.json<{ error: { code: string; hint: string } }>().error.hint).toContain(
      'varve.node.reparent',
    );
    expect(readFileSync(doc).equals(mid)).toBe(true);
  });
});

describe('hostile document text', () => {
  const HOSTILE_DOC = '\u001b[2J\u001b]0;pwned\u0007Quarterly';
  const HOSTILE_LAYER = '\u001b[31mOK\u001b[0m\r\u202egnp';

  function hostileDoc(dir: string): string {
    let doc = { ...createDocument(HOSTILE_DOC, { flat: true }), id: 'hostile-doc' };
    doc = addNode(
      doc,
      makeShapeNode(
        'h0_aaaa0000',
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: HOSTILE_LAYER },
      ),
    );
    const path = join(dir, 'hostile.varve');
    writeFileSync(path, DocumentCodec.encode({ ...doc, nextId: 2 }), 'utf8');
    return path;
  }

  it('does not let a document or layer name drive the terminal in text output', () => {
    const doc = hostileDoc(workDir());
    const text = varve(['inspect', '--file', doc]);
    expect(text.status).toBe(0);
    // Nothing a terminal would act on reaches stdout...
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
    expect(text.stdout).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/);
    // ...and the person can still see what the name was.
    expect(text.stdout).toContain('\\u001b[2J');
    expect(text.stdout).toContain('Quarterly');
    expect(text.stdout).toContain('\\u202egnp');
  });

  it('keeps the exact name in JSON output', () => {
    const doc = hostileDoc(workDir());
    const r = varve(['inspect', '--file', doc, '--json']);
    expect(r.status).toBe(0);
    const parsed = r.json<{ document: { name: string }; tree: Array<{ name: string }> }>();
    expect(parsed.document.name).toBe(HOSTILE_DOC);
    expect(parsed.tree[0]?.name).toBe(HOSTILE_LAYER);
  });
});

describe('doctor and legacy commands', () => {
  it('reports honestly that connected mode is unavailable', () => {
    const r = varve(['doctor', '--json']);
    const report = r.json<{ runtimes: { headless: boolean; connected: boolean } }>();
    expect(report.runtimes).toEqual({ headless: true, connected: false });
  });

  it('keeps the original document commands working', () => {
    const doc = flatDoc(workDir());
    const r = varve(['validate', doc]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
    expect(varve(['hash', doc]).stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('runs from an empty PATH and a directory with spaces (no esbuild, no pnpm)', () => {
    expect(bundle).toContain(' ');
    const r = varve(['help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('automation');
  });
});

describe('the launcher', () => {
  it('prefers the bundled CLI and does not load esbuild when it exists', () => {
    const dir = workDir();
    const launcherDir = join(dir, 'pkg');
    mkdirSync(join(launcherDir, 'bin'), { recursive: true });
    mkdirSync(join(launcherDir, 'dist'), { recursive: true });
    const launcher = readFileSync(join(here, '../../bin/varve.mjs'), 'utf8');
    writeFileSync(join(launcherDir, 'bin', 'varve.mjs'), launcher);
    writeFileSync(
      join(launcherDir, 'dist', 'varve.mjs'),
      'export async function mainAsync(argv){ process.stdout.write("bundled:"+argv.join(",")+"\\n"); return 0; }\n',
    );
    const result = spawnSync(process.execPath, [join(launcherDir, 'bin', 'varve.mjs'), 'a', 'b'], {
      encoding: 'utf8',
      env: { PATH: '' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('bundled:a,b\n');
  });

  it('explains how to build when neither a bundle nor esbuild is available', () => {
    const dir = workDir();
    const launcherDir = join(dir, 'pkg2');
    mkdirSync(join(launcherDir, 'bin'), { recursive: true });
    writeFileSync(
      join(launcherDir, 'bin', 'varve.mjs'),
      readFileSync(join(here, '../../bin/varve.mjs'), 'utf8'),
    );
    const result = spawnSync(process.execPath, [join(launcherDir, 'bin', 'varve.mjs'), 'help'], {
      encoding: 'utf8',
      env: { PATH: '' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('build:bundle');
  });
});
