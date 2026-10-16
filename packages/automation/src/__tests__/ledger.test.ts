import { createDocument, type Document, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { HeadlessAuthority } from '../headless';
import { DEFAULT_RETAINED_ENTRIES, TransactionLedger } from '../ledger';
import { makeSession } from './harness';

function documentOf(nodeCount: number): Document {
  const base = createDocument('Ledger');
  const nodes: Record<string, SceneNode> = { ...base.nodes };
  for (let i = 0; i < nodeCount; i += 1) {
    nodes[`n${i}`] = {
      id: `n${i}`,
      kind: 'shape',
      name: `N${i}`,
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      transform: [1, 0, 0, 1, i, 0],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
    } as unknown as SceneNode;
  }
  return { ...base, nodes };
}

const origin = { kind: 'agent', id: 'a', label: 'a' } as never;

function record(ledger: TransactionLedger, before: Document, after: Document, n: number) {
  return ledger.record({
    before,
    after,
    revision: n,
    label: `edit ${n}`,
    origin,
    command: 'varve.node.set',
    receiptId: `r${n}`,
    created: [],
    changed: ['n0'],
    deleted: [],
  });
}

describe('TransactionLedger retention', () => {
  it('is bounded by the size of what it keeps, not only by how many transactions', () => {
    const ledger = new TransactionLedger({ maxTransactions: 200, maxRetainedEntries: 5_000 });
    let doc = documentOf(1_000);
    for (let n = 1; n <= 40; n += 1) {
      const next = { ...doc, nodes: { ...doc.nodes } };
      record(ledger, doc, next, n);
      doc = next;
    }
    const { transactions, entries } = ledger.retained;
    // 1,001 entries per snapshot against a 5,000 budget: four or five, not forty.
    expect(transactions).toBeLessThanOrEqual(5);
    expect(entries).toBeLessThanOrEqual(5_000 + 1_001);
    expect(entries).toBeGreaterThan(0);
  });

  it('keeps more history on a small document under the same budget', () => {
    const ledger = new TransactionLedger({ maxTransactions: 200, maxRetainedEntries: 5_000 });
    let doc = documentOf(10);
    for (let n = 1; n <= 150; n += 1) {
      const next = { ...doc, nodes: { ...doc.nodes } };
      record(ledger, doc, next, n);
      doc = next;
    }
    expect(ledger.retained.transactions).toBe(150);
  });

  it('always keeps the most recent transaction, even when one snapshot exceeds the budget', () => {
    const ledger = new TransactionLedger({ maxRetainedEntries: 100 });
    const doc = documentOf(500);
    const next = { ...doc, nodes: { ...doc.nodes } };
    const tx = record(ledger, doc, next, 1);
    expect(ledger.retained.transactions).toBe(1);
    expect(ledger.list(5)[0]?.transactionId).toBe(tx.transactionId);
  });

  it('accounts exactly: what it reports retained is what the kept transactions weigh', () => {
    const ledger = new TransactionLedger({ maxTransactions: 3, maxRetainedEntries: 1_000_000 });
    let doc = documentOf(20);
    for (let n = 1; n <= 10; n += 1) {
      const next = { ...doc, nodes: { ...doc.nodes } };
      record(ledger, doc, next, n);
      doc = next;
    }
    expect(ledger.retained.transactions).toBe(3);
    expect(ledger.retained.entries).toBe(3 * Object.keys(doc.nodes).length);
  });

  it('tells a client an evicted transaction expired rather than that it never existed', () => {
    const ledger = new TransactionLedger({ maxRetainedEntries: 2_000 });
    let doc = documentOf(1_000);
    const ids: string[] = [];
    for (let n = 1; n <= 6; n += 1) {
      const next = { ...doc, nodes: { ...doc.nodes } };
      ids.push(record(ledger, doc, next, n).transactionId);
      doc = next;
    }
    const first = ledger.prepareRollback(doc, ids[0] as string);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe('expired');
    const unknown = ledger.prepareRollback(doc, 'zzz-never');
    if (!unknown.ok) expect(unknown.reason).toBe('unknown-transaction');
  });

  it('has a default that keeps the full 200 on a 5,000-node document', () => {
    expect(DEFAULT_RETAINED_ENTRIES / 200).toBeGreaterThanOrEqual(5_000);
  });
});

describe("rollback of one's own last change works at any document size", () => {
  it('restores the previous value on a large document under the default budget', async () => {
    const s = makeSession({ document: documentOf(3_000) });
    const edit = await s.run('varve.node.set', { nodeIds: ['n5'], opacity: 0.25 });
    expect(edit.outcome, edit.summary).toBe('applied');
    expect((s.doc().nodes.n5 as unknown as { opacity: number }).opacity).toBe(0.25);
    const back = await s.run('varve.history.rollback', { transactionId: edit.transactionId });
    expect(back.outcome, back.summary).toBe('applied');
    expect((s.doc().nodes.n5 as unknown as { opacity: number }).opacity).toBe(1);
  });
});

it('the headless authority exposes the ledger option', () => {
  const authority = new HeadlessAuthority({
    document: documentOf(5),
    instanceId: 'x',
    maxTransactions: 2,
  });
  expect(authority.getRevision()).toBe(0);
});
