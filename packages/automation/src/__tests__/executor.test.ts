import { nodeWorldTransform } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { CommandCatalog, defineCommand } from '../catalog';
import { Executor } from '../executor';
import { s } from '../schema';
import { addFrame, addRect, makeSession, principal } from './harness';

const EMPTY = s.object({});

describe('L1 strict validation: nothing is silently dropped or clamped', () => {
  it('rejects an unknown argument instead of ignoring it, and suggests the key', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      cornerRadious: 4,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVALID_ARGUMENT');
    expect(r.error?.issues?.[0]).toMatchObject({ code: 'unknown_key', path: '/cornerRadious' });
    expect(r.error?.issues?.[0]?.hint).toContain('cornerRadius');
    expect(s1.authority.getRevision()).toBe(0);
  });

  it('rejects a kind-specific argument on the wrong kind', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.create', {
      kind: 'ellipse',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      cornerRadius: 2,
    });
    expect(r.outcome).toBe('rejected');
  });

  it('rejects an out-of-range value; it is not clamped', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      index: 99999999,
    });
    expect(r.outcome).toBe('rejected');
    const id = await addRect(s1);
    const op = await s1.run('varve.node.set', { nodeIds: [id], opacity: 7 });
    expect(op.outcome).toBe('rejected');
    expect(op.error?.issues?.[0]?.code).toBe('out_of_range');
    expect((s1.doc().nodes[id] as { opacity: number }).opacity).toBe(1);
  });

  it('rejects a textAlign-style enum value that is not allowed', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    const r = await s1.run('varve.node.set', { nodeIds: [id], blendMode: 'diagonal' });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]).toMatchObject({ code: 'not_in_enum' });
  });

  it('rejects a malformed color instead of producing NaN channels', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    const r = await s1.run('varve.node.set', { nodeIds: [id], fill: 'zzzzzz' });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]?.code).toBe('pattern_mismatch');
  });

  it('rejects an unknown envelope key such as a caller-supplied principal', async () => {
    const s1 = makeSession();
    const r = await s1.executor.execute(s1.ctx, {
      command: 'varve.document.info',
      args: {},
      principal: { id: 'root', grants: ['edit'] },
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]).toMatchObject({ code: 'unknown_key', path: '/principal' });
  });

  it('defaults are applied explicitly and reported', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.list', {});
    expect(r.outcome).toBe('ok');
    expect(r.defaulted).toContain('/limit');
  });
});

describe('L2 no silent no-op reported as success', () => {
  it('refuses to create a child under a non-container, naming the kind', async () => {
    const s1 = makeSession();
    const shape = await addRect(s1);
    const before = s1.authority.getRevision();
    const r = await s1.run('varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      parentId: shape,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVARIANT_VIOLATION');
    expect(r.error?.message).toContain('shape');
    expect(s1.authority.getRevision()).toBe(before);
  });

  it('reports a move to the current position as no-op, not applied', async () => {
    const s1 = makeSession();
    const id = await addRect(s1, { x: 10, y: 20 });
    const before = s1.authority.getRevision();
    const r = await s1.run('varve.node.move', { mode: 'to', nodeId: id, x: 10, y: 20 });
    expect(r.outcome).toBe('no-op');
    expect(s1.authority.getRevision()).toBe(before);
  });

  it('reports reorder at the boundary as no-op', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    const r = await s1.run('varve.node.reorder', { nodeId: id, position: 'front' });
    expect(r.outcome).toBe('no-op');
  });

  it('refuses to resize a kind with no direct size', async () => {
    const s1 = makeSession();
    const doc = s1.doc();
    const group = Object.values(doc.nodes).find((n) => n.kind === 'group');
    expect(group).toBeDefined();
    const r = await s1.run('varve.node.resize', {
      nodeId: (group as { id: string }).id,
      width: 10,
      height: 10,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVARIANT_VIOLATION');
  });

  it('refuses to delete a page content root', async () => {
    const s1 = makeSession();
    const root = s1.doc().pages?.[0]?.contentRoot as string;
    const r = await s1.run('varve.node.delete', { nodeIds: [root] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVARIANT_VIOLATION');
    expect(s1.doc().nodes[root]).toBeDefined();
  });

  it('refuses the whole list when one id is unknown and mutates nothing', async () => {
    const s1 = makeSession();
    const a = await addRect(s1);
    const before = s1.authority.getRevision();
    const r = await s1.run('varve.node.delete', { nodeIds: [a, 'ghost-1', 'ghost-2'] });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNKNOWN_TARGET');
    expect(r.error?.message).toContain('ghost-1');
    expect(r.error?.message).toContain('ghost-2');
    expect(s1.doc().nodes[a]).toBeDefined();
    expect(s1.authority.getRevision()).toBe(before);
  });

  it('does not coerce a name into an id', async () => {
    const s1 = makeSession();
    await addRect(s1, { name: 'Hero' });
    const r = await s1.run('varve.node.set', { nodeIds: ['Hero'], opacity: 0.5 });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNKNOWN_TARGET');
    expect(r.error?.hint).toContain('varve.node.find');
  });
});

describe('name lookup is a query that reports ambiguity', () => {
  it('returns every match and flags ambiguity', async () => {
    const s1 = makeSession();
    await addRect(s1, { name: 'Card' });
    await addRect(s1, { name: 'Card' });
    await addRect(s1, { name: 'Other' });
    const r = await s1.run('varve.node.find', { name: 'Card' });
    const out = r.output as { matches: unknown[]; ambiguous: boolean; total: number };
    expect(out.total).toBe(2);
    expect(out.ambiguous).toBe(true);
  });
});

describe('L3 target pinning', () => {
  it('refuses a request pinned to a different document', async () => {
    const s1 = makeSession();
    const r = await s1.run(
      'varve.document.info',
      {},
      { target: { documentId: 'someone-elses-doc' } },
    );
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('TARGET_MISMATCH');
  });

  it('refuses a request pinned to a replaced session generation', async () => {
    const s1 = makeSession();
    const r = await s1.run(
      'varve.node.create',
      { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      { target: { generation: 'old-generation' } },
    );
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('TARGET_MISMATCH');
    expect(s1.authority.getRevision()).toBe(0);
  });

  it('accepts a correctly pinned request and reports the target', async () => {
    const s1 = makeSession();
    const info = await s1.run('varve.document.info', {});
    const out = info.output as {
      documentId: string;
      instance: { generation: string; instanceId: string };
    };
    const r = await s1.run(
      'varve.node.create',
      { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      {
        target: {
          documentId: out.documentId,
          generation: out.instance.generation,
          instanceId: out.instance.instanceId,
        },
      },
    );
    expect(r.outcome).toBe('applied');
    expect(r.target.mode).toBe('headless');
  });

  it('rejects a stale expected revision with resync guidance and no change', async () => {
    const s1 = makeSession();
    await addRect(s1);
    const r = await s1.run(
      'varve.node.create',
      { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
      { expectedRevision: 0 },
    );
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('REVISION_CONFLICT');
    expect(r.error?.retryable).toBe(true);
    expect(r.error?.hint).toContain('read');
  });
});

describe('L4/L18 authorization is enforced at the executor', () => {
  it('denies an edit to a read-only principal, through single and batch paths', async () => {
    const s1 = makeSession();
    const reader = s1.as(principal('reader', ['read']));
    const single = await s1.executor.execute(reader, {
      command: 'varve.node.create',
      args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
    });
    expect(single.outcome).toBe('rejected');
    expect(single.error?.code).toBe('PERMISSION_DENIED');

    const batch = await s1.executor.executeBatch(reader, {
      steps: [
        { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } },
      ],
    });
    expect(batch.outcome).toBe('rejected');
    expect(batch.error?.code).toBe('PERMISSION_DENIED');
    expect(s1.authority.getRevision()).toBe(0);
  });

  it('hides commands the principal cannot run from search and list', () => {
    const s1 = makeSession();
    const reader = principal('reader', ['read']);
    const visible = s1.executor.catalog.list({ principal: reader });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((c) => c.authorization === 'read')).toBe(true);
    const hits = s1.executor.catalog.search('create rectangle', { principal: reader });
    expect(hits.find((h) => h.id === 'varve.node.create')).toBeUndefined();
  });

  it('refuses to register commands in settings/permissions domains', () => {
    const catalog = new CommandCatalog();
    const bad = defineCommand({
      id: 'varve.settings.set',
      version: 1,
      title: 'Set a setting',
      summary: 'must never be exposed',
      effect: 'mutate',
      authorization: 'edit',
      runtimes: ['headless'],
      input: EMPTY,
      output: EMPTY,
      plan: (doc) => ({ doc, output: {}, label: 'x' }),
    });
    expect(() => catalog.register(bad)).toThrow(/never exposed/);
  });

  it('rejects an example that no longer matches its schema at registration', () => {
    const catalog = new CommandCatalog();
    const stale = defineCommand({
      id: 'varve.demo.echo',
      version: 1,
      title: 'Echo',
      summary: 'demo',
      effect: 'read',
      authorization: 'read',
      runtimes: ['headless'],
      input: s.object({ text: s.string({ maxBytes: 8 }) }),
      output: s.object({}),
      examples: [{ title: 'old', args: { message: 'hello' } }],
      query: () => ({}),
    });
    expect(() => catalog.register(stale)).toThrow(/no longer matches/);
  });

  it('suggests only commands the principal can see', async () => {
    const s1 = makeSession();
    const reader = s1.as(principal('reader', ['read']));
    const r = await s1.executor.execute(reader, { command: 'varve.node.creat' });
    expect(r.error?.code).toBe('UNKNOWN_COMMAND');
    expect(r.error?.hint ?? '').not.toContain('varve.node.create');
  });
});

describe('L7 limits are enforced at the authoritative boundary', () => {
  it('rejects duplicate ids rather than processing them twice', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    const r = await s1.run('varve.node.set', { nodeIds: [id, id, id], opacity: 0.5 });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]?.code).toBe('duplicate_item');
  });

  it('rejects an oversized id list', async () => {
    const s1 = makeSession();
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const r = await s1.run('varve.node.set', { nodeIds: ids, opacity: 0.5 });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]?.code).toBe('too_many_items');
  });

  it('counts UTF-8 bytes of multilingual text, not UTF-16 units', async () => {
    const s1 = makeSession();
    // 40,000 CJK characters = 120,000 UTF-8 bytes, but only 40,000 UTF-16 units.
    const r = await s1.run('varve.node.create', {
      kind: 'text',
      x: 0,
      y: 0,
      text: '日'.repeat(40_000),
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.issues?.[0]?.code).toBe('too_long');
  });

  it('caps the whole request in bytes', async () => {
    const s1 = makeSession({ executor: { limits: { maxRequestBytes: 2048 } } });
    const r = await s1.run('varve.node.create', {
      kind: 'text',
      x: 0,
      y: 0,
      text: '日'.repeat(1000),
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('LIMIT_EXCEEDED');
  });

  it('rejects non-finite numbers arriving from in-process callers', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.create', {
      kind: 'rect',
      x: Number.NaN,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVALID_ARGUMENT');
  });
});

describe('L12 idempotency and honest retries', () => {
  const args = { kind: 'rect', x: 1, y: 2, width: 30, height: 40 };

  it('replays the original receipt for a retried key without executing twice', async () => {
    const s1 = makeSession();
    const first = await s1.run('varve.node.create', args, { idempotencyKey: 'k-1' });
    const retry = await s1.run('varve.node.create', args, { idempotencyKey: 'k-1', attempt: 2 });
    expect(first.outcome).toBe('applied');
    expect(retry.outcome).toBe('applied');
    expect(retry.created).toEqual(first.created);
    expect(retry.idempotency).toMatchObject({ key: 'k-1', replayed: true });
    expect(retry.idempotency?.argsHash).toBe(first.idempotency?.argsHash);
    expect(Object.values(s1.doc().nodes).filter((n) => n.kind === 'shape')).toHaveLength(1);
    expect(s1.authority.getRevision()).toBe(1);
  });

  it('rejects reuse of a key with different arguments', async () => {
    const s1 = makeSession();
    await s1.run('varve.node.create', args, { idempotencyKey: 'k-2' });
    const r = await s1.run('varve.node.create', { ...args, x: 99 }, { idempotencyKey: 'k-2' });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(s1.authority.getRevision()).toBe(1);
  });

  it('reports an unknown outcome for a declared retry with no record, and does not execute', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.create', args, { idempotencyKey: 'never-seen', attempt: 2 });
    expect(r.outcome).toBe('unknown');
    expect(r.error?.code).toBe('OUTCOME_UNKNOWN');
    expect(s1.authority.getRevision()).toBe(0);
  });

  it('reports an unknown outcome once the record has been evicted', async () => {
    const s1 = makeSession({ executor: { idempotency: undefined } });
    const small = makeSession();
    void s1;
    // Exhaust retention with a tiny store.
    const { IdempotencyStore } = await import('../idempotency');
    const tiny = makeSession({
      executor: { idempotency: new IdempotencyStore({ maxEntries: 2 }) },
    });
    await tiny.run('varve.node.create', args, { idempotencyKey: 'a' });
    await tiny.run('varve.node.create', args, { idempotencyKey: 'b' });
    await tiny.run('varve.node.create', args, { idempotencyKey: 'c' });
    const nodesBefore = Object.keys(tiny.doc().nodes).length;
    const retry = await tiny.run('varve.node.create', args, { idempotencyKey: 'a', attempt: 2 });
    expect(retry.outcome).toBe('unknown');
    expect(Object.keys(tiny.doc().nodes).length).toBe(nodesBefore);
    void small;
  });

  it('scopes keys to the principal: another client never sees the receipt', async () => {
    const s1 = makeSession();
    await s1.run('varve.node.create', args, { idempotencyKey: 'shared' });
    const other = s1.as(principal('other-agent', ['read', 'edit']));
    const r = await s1.executor.execute(other, {
      command: 'varve.node.create',
      args,
      idempotencyKey: 'shared',
      attempt: 2,
    });
    expect(r.outcome).toBe('unknown');
  });

  it('does not record dry runs', async () => {
    const s1 = makeSession();
    const preview = await s1.run('varve.node.create', args, {
      idempotencyKey: 'dry',
      dryRun: true,
    });
    expect(preview.outcome).toBe('preview');
    expect(s1.authority.getRevision()).toBe(0);
    const real = await s1.run('varve.node.create', args, { idempotencyKey: 'dry' });
    expect(real.outcome).toBe('applied');
  });
});

describe('L15 batches are atomic or explicitly partial', () => {
  it('commits an atomic batch as one transaction and resolves $ref ids', async () => {
    const s1 = makeSession();
    const r = await s1.executor.executeBatch(s1.ctx, {
      mode: 'atomic',
      steps: [
        {
          command: 'varve.node.create',
          alias: 'box',
          args: { kind: 'frame', x: 0, y: 0, width: 200, height: 200 },
        },
        {
          command: 'varve.node.create',
          alias: 'dot',
          args: {
            kind: 'ellipse',
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            parentId: { $ref: 'box#/created/0' },
          },
        },
        {
          command: 'varve.node.set',
          args: { nodeIds: [{ $ref: 'dot#/created/0' }], opacity: 0.5 },
        },
      ],
    });
    expect(r.outcome).toBe('applied');
    expect(r.created).toHaveLength(2);
    expect(s1.authority.listTransactions()).toHaveLength(1);
    expect(r.idMap.box).toBe(r.created[0]);
    const dot = s1.doc().nodes[r.idMap.dot as string] as { opacity: number };
    expect(dot.opacity).toBe(0.5);
  });

  it('commits nothing when a later step fails, and leaves history untouched', async () => {
    const s1 = makeSession();
    const before = s1.authority.getRevision();
    const r = await s1.executor.executeBatch(s1.ctx, {
      steps: [
        { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 } },
        { command: 'varve.node.set', args: { nodeIds: ['nope'], opacity: 0.5 } },
      ],
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.details?.step).toBe(1);
    expect(s1.authority.getRevision()).toBe(before);
    expect(s1.authority.listTransactions()).toHaveLength(0);
    expect(Object.values(s1.doc().nodes).some((n) => n.kind === 'shape')).toBe(false);
  });

  it('rejects an unresolved $ref before executing anything', async () => {
    const s1 = makeSession();
    const r = await s1.executor.executeBatch(s1.ctx, {
      steps: [
        { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 } },
        {
          command: 'varve.node.set',
          args: { nodeIds: [{ $ref: 'missing#/created/0' }], opacity: 0.5 },
        },
      ],
    });
    expect(r.outcome).toBe('rejected');
    expect(s1.authority.getRevision()).toBe(0);
  });

  it('partial mode reports per-step outcomes and keeps applied steps as separate undo groups', async () => {
    const s1 = makeSession();
    const r = await s1.executor.executeBatch(s1.ctx, {
      mode: 'partial',
      onError: 'continue',
      steps: [
        { command: 'varve.node.create', args: { kind: 'rect', x: 0, y: 0, width: 5, height: 5 } },
        { command: 'varve.node.delete', args: { nodeIds: ['ghost'] } },
        { command: 'varve.node.create', args: { kind: 'rect', x: 9, y: 9, width: 5, height: 5 } },
      ],
    });
    expect(r.outcome).toBe('partial');
    expect(r.steps.map((x) => x.receipt.outcome)).toEqual(['applied', 'rejected', 'applied']);
    expect(s1.authority.listTransactions()).toHaveLength(2);
  });

  it('refuses external effects inside an atomic batch', async () => {
    const catalog = new CommandCatalog();
    catalog.register(
      defineCommand({
        id: 'varve.export.demo',
        version: 1,
        title: 'Export',
        summary: 'writes a file',
        effect: 'external',
        authorization: 'export',
        runtimes: ['headless'],
        input: s.object({}),
        output: s.object({}),
      }),
    );
    const s1 = makeSession({ executor: { catalog } });
    const r = await s1.executor.executeBatch(s1.ctx, {
      mode: 'atomic',
      steps: [{ command: 'varve.export.demo' }],
    });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.message).toContain('atomic');
  });

  it('caps the number of steps', async () => {
    const s1 = makeSession();
    const steps = Array.from({ length: 101 }, () => ({ command: 'varve.document.info' }));
    const r = await s1.executor.executeBatch(s1.ctx, { steps });
    expect(r.outcome).toBe('rejected');
  });
});

describe('L17 locks are enforced for every adapter', () => {
  it('refuses edits to a locked node and to a node under a locked ancestor', async () => {
    const s1 = makeSession();
    const frame = await addFrame(s1);
    const child = await addRect(s1, { parentId: frame });
    await s1.run('varve.node.set', { nodeIds: [frame], locked: true });

    const move = await s1.run('varve.node.move', { mode: 'by', nodeIds: [child], dx: 5, dy: 5 });
    expect(move.outcome).toBe('rejected');
    expect(move.error?.code).toBe('LOCKED');
    expect(move.error?.message).toContain(frame);

    const del = await s1.run('varve.node.delete', { nodeIds: [child] });
    expect(del.error?.code).toBe('LOCKED');
    expect(s1.doc().nodes[child]).toBeDefined();
  });

  it('allows unlocking, and an edit in the same call that unlocks', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    await s1.run('varve.node.set', { nodeIds: [id], locked: true });
    const blocked = await s1.run('varve.node.set', { nodeIds: [id], opacity: 0.2 });
    expect(blocked.error?.code).toBe('LOCKED');
    const ok = await s1.run('varve.node.set', { nodeIds: [id], locked: false, opacity: 0.2 });
    expect(ok.outcome).toBe('applied');
  });
});

describe('coordinates follow the editor: parent-local translation', () => {
  it('moves by setting the transform translation, as setNodePosition does', async () => {
    const s1 = makeSession();
    const id = await addRect(s1, { x: 10, y: 10 });
    await s1.run('varve.node.move', { mode: 'to', nodeId: id, x: 100, y: 50 });
    const node = s1.doc().nodes[id] as unknown as { transform: number[] };
    expect([node.transform[4], node.transform[5]]).toEqual([100, 50]);
  });

  it('reparent keeps the on-canvas position by recomputing the local transform', async () => {
    const s1 = makeSession();
    const frame = await addFrame(s1, { x: 200, y: 100 });
    const id = await addRect(s1, { x: 30, y: 40 });
    const before = nodeWorldTransform(s1.doc(), id);
    const r = await s1.run('varve.node.reparent', { nodeId: id, parentId: frame });
    expect(r.outcome).toBe('applied');
    const after = nodeWorldTransform(s1.doc(), id);
    for (let i = 0; i < 6; i++) expect(after[i]).toBeCloseTo(before[i] as number, 6);
    const local = s1.doc().nodes[id] as unknown as { transform: number[] };
    expect([local.transform[4], local.transform[5]]).not.toEqual([30, 40]);
  });

  it('refuses to move a node into its own descendant', async () => {
    const s1 = makeSession();
    const outer = await addFrame(s1);
    const inner = await addFrame(s1, { parentId: outer, width: 50, height: 50 });
    const r = await s1.run('varve.node.reparent', { nodeId: outer, parentId: inner });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('attributed rollback does not erase other work', () => {
  it('rolls back an earlier create when later work is unrelated', async () => {
    const s1 = makeSession();
    const a = await s1.run('varve.node.create', { kind: 'rect', x: 0, y: 0, width: 5, height: 5 });
    const b = await s1.run('varve.node.create', {
      kind: 'rect',
      x: 50,
      y: 50,
      width: 5,
      height: 5,
    });
    const r = await s1.run('varve.history.rollback', { transactionId: a.transactionId });
    expect(r.outcome).toBe('applied');
    expect(s1.doc().nodes[a.created[0] as string]).toBeUndefined();
    expect(s1.doc().nodes[b.created[0] as string]).toBeDefined();
  });

  it('refuses when a later transaction changed the same node, naming it', async () => {
    const s1 = makeSession();
    const a = await s1.run('varve.node.create', { kind: 'rect', x: 0, y: 0, width: 5, height: 5 });
    const id = a.created[0] as string;
    const edit = await s1.run('varve.node.set', { nodeIds: [id], opacity: 0.3 });
    const r = await s1.run('varve.history.rollback', { transactionId: a.transactionId });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('CONFLICT');
    expect(r.error?.details?.conflictingTransactions).toContain(edit.transactionId);
    expect(s1.doc().nodes[id]).toBeDefined();
  });

  it('records who made each transaction', async () => {
    const s1 = makeSession();
    await s1.run('varve.node.create', { kind: 'rect', x: 0, y: 0, width: 5, height: 5 });
    const agent = s1.as(principal('agent-7', ['read', 'edit']));
    await s1.executor.execute(agent, {
      command: 'varve.node.create',
      args: { kind: 'rect', x: 9, y: 9, width: 5, height: 5 },
    });
    const log = (await s1.run('varve.history.list', {})).output as {
      transactions: Array<{ origin: { principalId: string; kind: string } }>;
    };
    expect(log.transactions[0]?.origin.principalId).toBe('agent-7');
    expect(log.transactions[0]?.origin.kind).toBe('agent');
    expect(log.transactions[1]?.origin.principalId).toBe('local-owner');
  });

  it('reports an expired transaction distinctly from an unknown one', async () => {
    const { HeadlessAuthority } = await import('../headless');
    const { createDocument } = await import('@varve/scene');
    const authority = new HeadlessAuthority({ document: createDocument('x'), maxTransactions: 2 });
    const { createStandardCatalog } = await import('../commands');
    const { ownerPrincipal } = await import('../principal');
    const exec = new Executor({ catalog: createStandardCatalog() });
    const ctx = { principal: ownerPrincipal(), authority };
    const first = await exec.execute(ctx, {
      command: 'varve.node.create',
      args: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
    });
    for (let i = 0; i < 3; i++) {
      await exec.execute(ctx, {
        command: 'varve.node.create',
        args: { kind: 'rect', x: i, y: 0, width: 1, height: 1 },
      });
    }
    const r = await exec.execute(ctx, {
      command: 'varve.history.rollback',
      args: { transactionId: first.transactionId },
    });
    expect(r.error?.code).toBe('HISTORY_EXPIRED');
    const unknown = await exec.execute(ctx, {
      command: 'varve.history.rollback',
      args: { transactionId: 't9999' },
    });
    expect(unknown.error?.code).toBe('UNKNOWN_TARGET');
  });
});

describe('receipts', () => {
  it('carry a readable summary, canonical ids, alias map and revision pair', async () => {
    const s1 = makeSession();
    const r = await s1.run(
      'varve.node.create',
      { kind: 'rect', x: 0, y: 0, width: 5, height: 5 },
      { alias: 'hero' },
    );
    expect(r.schema).toBe('varve.receipt/1');
    expect(r.summary.length).toBeGreaterThan(10);
    expect(r.revision).toEqual({ before: 0, after: 1 });
    expect(r.idMap.hero).toBe(r.created[0]);
    expect(r.durable.saved).toBe(false);
    expect(r.target.documentId).toBe(s1.authority.info().documentId);
  });

  it('dry run previews exact id sets and changes nothing', async () => {
    const s1 = makeSession();
    const id = await addRect(s1);
    const before = s1.authority.getRevision();
    const r = await s1.run('varve.node.delete', { nodeIds: [id] }, { dryRun: true });
    expect(r.outcome).toBe('preview');
    expect(r.deleted).toEqual([id]);
    expect(s1.authority.getRevision()).toBe(before);
    expect(s1.doc().nodes[id]).toBeDefined();
  });

  it('reports a schema-version mismatch for a stale client', async () => {
    const s1 = makeSession();
    const r = await s1.run('varve.node.list', {}, { commandVersion: 9 });
    expect(r.error?.code).toBe('SCHEMA_VERSION_MISMATCH');
  });
});
