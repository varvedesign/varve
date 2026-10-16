/**
 * Measured cost of the command layer, with budgets set from observation.
 *
 * What this is for: catching a change that makes something quadratic, unbounded
 * or ten times larger, on a modest machine under load. What it is not: a
 * benchmark of the editor, the canvas or the GPU, and it does not time anything
 * that needs a browser. Every number printed is a measurement from this run,
 * written to VARVE_PERF_REPORT (JSON) when that is set; the checked-in record
 * is docs/perf/agent-control-baseline-2026-10-16.md.
 *
 * Budgets are deliberately loose (several times the observed value) because a
 * shared CI host is noisy; they exist to fail on a regression of kind, not on
 * jitter. Ratios (how cost grows with size) are stricter than absolutes, since
 * a ratio is stable across hosts.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { createDocument, type Document, type SceneNode } from '@varve/scene';
import { generateNKeysBetween } from '@varve/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStandardCatalog } from '../commands';
import { defaultInsertionParent } from '../surface';
import { canonicalJson, utf8ByteLength } from '../text';
import { makeSession } from './harness';

const metrics: Record<string, unknown> = {};

// The packaged CLI is bundled with NODE_ENV pinned to "production" (see
// packages/cli/scripts/build-bundle.mjs), and so is the desktop build. Measure
// that path. The scene package's `devValidate` re-validates the whole document
// after every operation otherwise, which is a development diagnostic and is
// measured separately below so the difference is a number, not an assertion.
const originalEnv = process.env.NODE_ENV;
beforeAll(() => {
  process.env.NODE_ENV = 'production';
});
afterAll(() => {
  if (originalEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv;
});

function bytesOf(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function time(runs: number, work: () => Promise<unknown>) {
  await work(); // warm the JIT; the first call is not what a session pays
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await work();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: Number(percentile(samples, 50).toFixed(3)),
    p95: Number(percentile(samples, 95).toFixed(3)),
    max: Number((samples.at(-1) ?? 0).toFixed(3)),
  };
}

/**
 * Build the fixture in one pass. Adding nodes one at a time through the
 * immutable operations copies the whole node table on every call, which is
 * quadratic and would make this measure the fixture, not the commands.
 */
function documentWithNodes(count: number): Document {
  const base = createDocument('Perf');
  const orders = generateNKeysBetween(null, null, count);
  const nodes: Record<string, SceneNode> = { ...base.nodes };
  const rootChildren = [...base.rootChildren];
  const added: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `p${i}`;
    nodes[id] = {
      id,
      kind: 'shape',
      name: `Layer ${i % 50}`,
      order: orders[i],
      index: i,
      shape: { kind: 'rect', x: 0, y: 0, w: 10 + (i % 7), h: 10 },
      transform: [1, 0, 0, 1, i % 900, Math.floor(i / 900) * 12],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
    } as unknown as SceneNode;
    added.push(id);
  }
  // Where the commands look: the active page's content root, as a person's
  // new layers would be.
  const parentId = defaultInsertionParent(base);
  const parent = parentId ? (nodes[parentId] as unknown as { children: string[] }) : null;
  if (parentId && parent) {
    nodes[parentId] = {
      ...parent,
      children: [...parent.children, ...added],
    } as unknown as SceneNode;
  } else {
    rootChildren.push(...added);
  }
  return { ...base, nodes, rootChildren };
}

describe('discovery volume', () => {
  it('keeps what an agent must read to find and use a command small', () => {
    const catalog = createStandardCatalog();
    const summaries = catalog.list();
    const descriptions = summaries.map((s) => catalog.describe(s.id));
    const listBytes = bytesOf(summaries);
    const describeAll = bytesOf(descriptions);
    const largest = Math.max(...descriptions.map((d) => bytesOf(d)));
    const search = bytesOf(catalog.search('create a rectangle'));
    metrics.discovery = {
      commands: summaries.length,
      listBytes,
      describeAllBytes: describeAll,
      largestDescriptionBytes: largest,
      searchBytes: search,
    };
    // A list that does not need every schema is the point of progressive disclosure.
    expect(listBytes).toBeLessThan(describeAll / 4);
    expect(largest).toBeLessThan(24 * 1024);
    expect(search).toBeLessThan(8 * 1024);
    expect(listBytes).toBeLessThan(16 * 1024);
  });
});

describe('command latency grows with the document, not with the history', () => {
  it('reads stay fast on 1,000 and 10,000 nodes, and scale roughly linearly', async () => {
    const result: Record<string, unknown> = {};
    const nodeList: Record<number, number> = {};
    for (const count of [1_000, 10_000]) {
      const s = makeSession({ document: documentWithNodes(count) });
      const info = await time(10, () => s.run('varve.document.info', {}));
      const list = await time(10, () => s.run('varve.node.list', { limit: 500 }));
      const get = await time(10, () => s.run('varve.node.get', { nodeIds: ['p5', 'p6', 'p7'] }));
      const find = await time(10, () => s.run('varve.node.find', { name: 'Layer 7', limit: 50 }));
      const create = await time(10, () =>
        s.run('varve.node.create', { kind: 'rect', x: 1, y: 2, width: 30, height: 40 }),
      );
      result[String(count)] = { info, list, get, find, create };
      nodeList[count] = list.p50;
      // Budgets: generous absolutes for a loaded laptop-class host.
      expect(info.p95).toBeLessThan(250);
      expect(get.p95).toBeLessThan(250);
      expect(find.p95).toBeLessThan(count === 10_000 ? 1500 : 400);
    }
    metrics.latencyMs = result;
    // Ten times the nodes may cost more, but not a hundred times more.
    expect(nodeList[10_000]).toBeLessThan(Math.max(nodeList[1_000], 0.5) * 60);
  }, 120_000);
});

describe('the development-only whole-document check', () => {
  it('is what made every edit cost O(document), which is why the bundle pins production', async () => {
    const s = makeSession({ document: documentWithNodes(2_000) });
    const create = () =>
      s.run('varve.node.create', { kind: 'rect', x: 1, y: 2, width: 30, height: 40 });
    process.env.NODE_ENV = 'production';
    const production = await time(8, create);
    process.env.NODE_ENV = 'development';
    const development = await time(8, create);
    process.env.NODE_ENV = 'production';
    metrics.devValidationContrastMs = { nodes: 2_000, production, development };
    // Not a timing budget: a statement that the diagnostic is the dominant cost
    // here, so removing the define from the bundle would be a visible regression.
    expect(production.p50).toBeLessThan(development.p50);
  }, 120_000);
});

describe('batch throughput', () => {
  const steps = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      command: 'varve.node.create',
      args: { kind: 'rect', x: i, y: i, width: 10, height: 10 },
    }));

  it('an atomic batch costs about the same per step at 25 as at 100 steps', async () => {
    const result: Record<string, unknown> = {};
    const perStep: Record<number, number> = {};
    for (const count of [25, 50, 100]) {
      const s = makeSession();
      const start = performance.now();
      const r = await s.executor.executeBatch(s.ctx, { mode: 'atomic', steps: steps(count) });
      const ms = performance.now() - start;
      expect(r.outcome).toBe('applied');
      perStep[count] = ms / count;
      result[String(count)] = {
        totalMs: Number(ms.toFixed(1)),
        perStepMs: Number((ms / count).toFixed(3)),
        receiptBytes: bytesOf(r),
        undoGroups: 1,
      };
    }
    metrics.batch = result;
    // Linear, not quadratic: per-step cost may not balloon as the batch grows.
    expect(perStep[100]).toBeLessThan(Math.max(perStep[25], 0.05) * 6);
  }, 120_000);

  it('a hundred separate commands cost about what the batch does, plus per-command overhead', async () => {
    const s = makeSession();
    const start = performance.now();
    for (const step of steps(100)) await s.run(step.command, step.args);
    const ms = performance.now() - start;
    metrics.hundredSingles = {
      totalMs: Number(ms.toFixed(1)),
      perCommandMs: Number((ms / 100).toFixed(3)),
    };
    expect(ms / 100).toBeLessThan(150);
  }, 120_000);
});

describe('response size is bounded by contract, not by luck', () => {
  it('a full page of nodes, and a lookup, stay within a few hundred kilobytes', async () => {
    const s = makeSession({ document: documentWithNodes(2_000) });
    const page = await s.run('varve.node.list', { limit: 500 });
    const get = await s.run('varve.node.get', {
      nodeIds: Array.from({ length: 100 }, (_, i) => `p${i}`),
    });
    metrics.responseBytes = { nodeList500: bytesOf(page), nodeGet100: bytesOf(get) };
    expect(bytesOf(page)).toBeLessThan(512 * 1024);
    expect(bytesOf(get)).toBeLessThan(512 * 1024);
  });

  it('refuses a request over the byte limit before doing any work', async () => {
    const s = makeSession();
    const huge = {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      name: 'x'.repeat(2 * 1024 * 1024),
    };
    const start = performance.now();
    const r = await s.run('varve.node.create', huge);
    metrics.oversizeRefusalMs = Number((performance.now() - start).toFixed(2));
    expect(r.outcome).toBe('rejected');
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('long sessions do not grow without bound', () => {
  it('thousands of keyed commands keep the retained state inside its budgets', async () => {
    const s = makeSession();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3_000; i += 1) {
      const r = await s.run(
        'varve.node.create',
        { kind: 'rect', x: i % 500, y: 0, width: 5, height: 5 },
        { idempotencyKey: `k${i}` },
      );
      if (r.outcome !== 'applied') throw new Error(r.summary);
    }
    const retained = (s.executor as unknown as { idempotency: { size: number; bytes: number } })
      .idempotency;
    const after = process.memoryUsage().heapUsed;
    metrics.longSession = {
      commands: 3_000,
      idempotencyEntries: retained.size,
      idempotencyBytes: retained.bytes,
      heapGrowthMB: Number(((after - before) / 1024 / 1024).toFixed(1)),
    };
    expect(retained.size).toBeLessThanOrEqual(1024);
    expect(retained.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  }, 120_000);

  it('canonical JSON of a large value is linear in its size', () => {
    const make = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    const t = (n: number) => {
      const value = make(n);
      const start = performance.now();
      canonicalJson(value);
      return performance.now() - start;
    };
    t(2_000); // warm
    const small = t(5_000);
    const large = t(50_000);
    metrics.canonicalJsonMs = { n5000: Number(small.toFixed(2)), n50000: Number(large.toFixed(2)) };
    expect(large).toBeLessThan(Math.max(small, 1) * 60);
  });
});

it('writes the measurements when asked', () => {
  const path = process.env.VARVE_PERF_REPORT;
  if (!path) return;
  writeFileSync(
    path,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()[0]?.model,
        cpus: os.cpus().length,
        loadAverage: os.loadavg().map((n) => Number(n.toFixed(2))),
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        metrics,
      },
      null,
      2,
    ),
  );
});
