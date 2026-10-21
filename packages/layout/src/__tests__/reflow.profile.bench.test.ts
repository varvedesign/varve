/**
 * Profiles cold first reflow and warm p50/p95 on flat and recursively nested
 * flex corpora. Run explicitly when recording a performance baseline:
 *   pnpm exec vitest run packages/layout/src/__tests__/reflow.profile.bench.test.ts --maxWorkers=1 --reporter=verbose
 * The output is observational; reflow.bench.test.ts owns stable time budgets.
 */
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { expect, test } from 'vitest';
import { reflowLayoutChildren } from '../reflow';

function buildFlat(count: number): { doc: Document; root: NodeId } {
  const nodes: Record<string, SceneNode> = {};
  const children: NodeId[] = [];
  for (let i = 0; i < count; i++) {
    const id = `flat-${i}` as NodeId;
    nodes[id] = {
      kind: 'shape',
      id,
      name: `Shape ${i}`,
      order: `a${i}`,
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 32 },
      layoutSizingWidth: 'fill',
      layoutSizingHeight: 'fixed',
    } as unknown as SceneNode;
    children.push(id);
  }
  const root = 'flat-root' as NodeId;
  nodes[root] = {
    kind: 'frame',
    id: root,
    name: 'Flat benchmark',
    order: 'a0',
    transform: [1, 0, 0, 1, 0, 0],
    w: 1200,
    h: Math.max(800, count * 40),
    children,
    layoutStyle: {
      mode: 'flex',
      layoutSemanticsVersion: 2,
      direction: 'row',
      wrap: true,
      gap: 8,
      padding: [12, 12, 12, 12],
      grow: 0,
      shrink: 0,
    },
  } as unknown as SceneNode;
  return {
    root,
    doc: { nodes, rootChildren: [root], pages: [], guides: [] } as unknown as Document,
  };
}

function buildNested(
  depth: number,
  perFrame: number,
): { doc: Document; root: NodeId; count: number } {
  const nodes: Record<string, SceneNode> = {};
  let count = 0;
  function frame(level: number, parentPath: string): NodeId {
    const id = `${parentPath}-f${level}` as NodeId;
    const children: NodeId[] = [];
    if (level > 0) {
      for (let i = 0; i < perFrame; i++) children.push(frame(level - 1, `${id}-${i}`));
    } else {
      for (let i = 0; i < perFrame; i++) {
        const child = `${id}-s${i}` as NodeId;
        nodes[child] = {
          kind: 'shape',
          id: child,
          name: child,
          order: `a${i}`,
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 40, h: 20 },
        } as unknown as SceneNode;
        children.push(child);
        count++;
      }
    }
    nodes[id] = {
      kind: 'frame',
      id,
      name: id,
      order: 'a0',
      transform: [1, 0, 0, 1, 0, 0],
      w: 800,
      h: 600,
      children,
      layoutStyle: {
        mode: 'flex',
        layoutSemanticsVersion: 2,
        direction: level % 2 ? 'row' : 'column',
        wrap: true,
        gap: 6,
        padding: [8, 8, 8, 8],
        grow: 0,
        shrink: 0,
      },
    } as unknown as SceneNode;
    return id;
  }
  const root = frame(depth, 'nested') as NodeId;
  return {
    root,
    count,
    doc: { nodes, rootChildren: [root], pages: [], guides: [] } as unknown as Document,
  };
}

function sample(doc: Document, root: NodeId, rounds = 12) {
  const startCold = performance.now();
  const materialized = reflowLayoutChildren(doc, root);
  const coldMs = performance.now() - startCold;
  const warm: number[] = [];
  const settled: number[] = [];
  let stableIdentity = true;
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    reflowLayoutChildren(doc, root);
    warm.push(performance.now() - start);
  }
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    stableIdentity = reflowLayoutChildren(materialized, root) === materialized && stableIdentity;
    settled.push(performance.now() - start);
  }
  warm.sort((a, b) => a - b);
  settled.sort((a, b) => a - b);
  return {
    coldMs,
    warmP50Ms: warm[Math.floor(warm.length * 0.5)],
    warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
    settledP50Ms: settled[Math.floor(settled.length * 0.5)],
    settledP95Ms: settled[Math.ceil(settled.length * 0.95) - 1],
    stableIdentity,
  };
}

test('cold and warm reflow profile across flat and nested documents', () => {
  for (const count of [100, 1_000, 10_000, 50_000]) {
    const { doc, root } = buildFlat(count);
    const profile = sample(doc, root);
    expect(profile.coldMs).toBeGreaterThan(0);
    expect(profile.warmP50Ms).toBeGreaterThan(0);
    expect(profile.stableIdentity).toBe(true);
    console.log(
      JSON.stringify({ corpus: 'flat-flex-wrap/fill-fixed-80x32', nodes: count, ...profile }),
    );
  }
  const nested = buildNested(4, 4);
  const profile = sample(nested.doc, nested.root);
  expect(profile.coldMs).toBeGreaterThan(0);
  expect(profile.warmP50Ms).toBeGreaterThan(0);
  expect(profile.stableIdentity).toBe(true);
  console.log(
    JSON.stringify({
      corpus: 'nested-flex-alternating-row-column',
      depth: 4,
      branches: 4,
      leaves: nested.count,
      ...profile,
    }),
  );
}, 120_000);
