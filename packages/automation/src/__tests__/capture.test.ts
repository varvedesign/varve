import { describe, expect, it } from 'vitest';
import { CAPTURE_MAX_DIMENSION, CAPTURE_MAX_IMAGE_BYTES } from '../commands';
import type { ExternalHandler } from '../executor';
import { DEFAULT_IDEMPOTENCY_BYTES, IdempotencyStore } from '../idempotency';
import type { Receipt } from '../receipt';
import { addRect, makeSession, principal } from './harness';

/** A session whose authority reports itself as a live application. */
function connected(
  externals?: Record<string, ExternalHandler>,
  grants = ['read', 'edit', 'capture'],
) {
  const base = makeSession({
    executor: {},
    principal: principal('agent', grants as never),
  });
  const authority = new Proxy(base.authority, {
    get(target, property) {
      if (property === 'info') return () => ({ ...target.info(), mode: 'connected' as const });
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const ctx = { ...base.ctx, authority, ...(externals ? { externals } : {}) };
  return {
    base,
    run: (command: string, args?: unknown, extra?: Record<string, unknown>) =>
      base.executor.execute(ctx, { command, args, ...extra }),
  };
}

const PNG_B64 = 'iVBORw0KGgo=';

function goodOutput(nodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'document-pixels',
    nodeId,
    revision: 1,
    currentRevision: 1,
    complete: true,
    warnings: [],
    width: 100,
    height: 50,
    scale: 1,
    bounds: { x: 0, y: 0, w: 100, h: 50 },
    background: 'white',
    renderMs: 12,
    backend: 'export-pipeline/canvas2d',
    image: { mimeType: 'image/png', bytes: 8, data: PNG_B64 },
    ...overrides,
  };
}

describe('varve.capture.node', () => {
  it('is not offered to a headless session, which has nothing to render', async () => {
    const s = makeSession();
    const id = await addRect(s);
    const r = await s.run('varve.capture.node', { nodeId: id });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNAVAILABLE');
    expect(r.error?.message).toMatch(/connected|headless/i);
  });

  it('needs the capture permission, which edit does not imply', async () => {
    const c = connected({ 'varve.capture.node': () => ({ ok: true, summary: 'x', output: {} }) }, [
      'read',
      'edit',
    ]);
    const r = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.error?.code).toBe('PERMISSION_DENIED');
  });

  it('fails clearly when no renderer is attached rather than answering with nothing', async () => {
    const c = connected();
    const r = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.outcome).toBe('rejected');
    expect(r.error?.code).toBe('UNAVAILABLE');
    expect(r.error?.message).toContain('no runtime handler');
  });

  it('applies the documented defaults before the handler sees the request', async () => {
    let seen: unknown;
    const c = connected({
      'varve.capture.node': (args) => {
        seen = args;
        return { ok: true, summary: 'Captured.', output: goodOutput('n') };
      },
    });
    const r = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.outcome).toBe('applied');
    expect(seen).toEqual({ nodeId: 'n', maxDimension: 1024, background: 'white' });
    expect(r.defaulted).toEqual(expect.arrayContaining(['/maxDimension', '/background']));
    expect((r.output as { image: { mimeType: string } }).image.mimeType).toBe('image/png');
  });

  it('rejects out-of-range, unknown and misspelled arguments before any rendering', async () => {
    let called = false;
    const c = connected({
      'varve.capture.node': () => {
        called = true;
        return { ok: true, summary: 'x', output: goodOutput('n') };
      },
    });
    for (const args of [
      { nodeId: 'n', maxDimension: CAPTURE_MAX_DIMENSION + 1 },
      { nodeId: 'n', maxDimension: 8 },
      { nodeId: 'n', maxDimension: 100.5 },
      { nodeId: 'n', background: 'black' },
      { nodeId: 'n', maxDimention: 400 },
      { nodeId: '' },
      {},
    ]) {
      const r = await c.run('varve.capture.node', args);
      expect(r.outcome, JSON.stringify(args)).toBe('rejected');
      expect(r.error?.code, JSON.stringify(args)).toBe('INVALID_ARGUMENT');
    }
    expect(called).toBe(false);
  });

  it('does not accept a handler result that breaks the output contract', async () => {
    const c = connected({
      'varve.capture.node': () => ({
        ok: true,
        summary: 'x',
        output: goodOutput('n', { image: { mimeType: 'text/html', bytes: 8, data: PNG_B64 } }),
      }),
    });
    const r: Receipt = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.outcome).not.toBe('applied');
  });

  it('refuses an image bigger than the contract allows', async () => {
    const huge = 'A'.repeat(Math.ceil((CAPTURE_MAX_IMAGE_BYTES * 4) / 3) + 1024);
    const c = connected({
      'varve.capture.node': () => ({
        ok: true,
        summary: 'x',
        output: goodOutput('n', { image: { mimeType: 'image/png', bytes: 8, data: huge } }),
      }),
    });
    const r = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.outcome).not.toBe('applied');
  });

  it('carries a handler refusal through unchanged', async () => {
    const c = connected({
      'varve.capture.node': () => ({
        ok: false,
        code: 'UNKNOWN_TARGET',
        message: 'node n does not exist in the open document',
      }),
    });
    const r = await c.run('varve.capture.node', { nodeId: 'n' });
    expect(r.error?.code).toBe('UNKNOWN_TARGET');
  });
});

describe('idempotency store byte budget', () => {
  const entry = (key: string, payload: string) => ({
    key,
    principalId: 'p',
    documentId: 'd',
    operation: 'varve.capture.node',
    argsHash: 'h',
    receipt: { outcome: 'applied', summary: 's', output: { payload } } as never,
    storedAt: Date.now(),
  });

  it('is bounded by encoded size, not just by entry count', () => {
    const store = new IdempotencyStore({ maxBytes: 10_000, maxEntries: 1000 });
    for (let i = 0; i < 20; i += 1) store.record(entry(`k${i}`, 'x'.repeat(2_000)));
    expect(store.bytes).toBeLessThanOrEqual(10_000);
    expect(store.size).toBeLessThan(20);
    // The newest survive; the oldest were evicted first.
    expect(store.lookup('p', 'd', 'k19')).toBeDefined();
    expect(store.lookup('p', 'd', 'k0')).toBeUndefined();
  });

  it('does not retain a receipt larger than the whole budget, and says so', () => {
    const store = new IdempotencyStore({ maxBytes: 1_000 });
    expect(store.record(entry('big', 'x'.repeat(5_000)))).toBe(false);
    expect(store.lookup('p', 'd', 'big')).toBeUndefined();
    expect(store.bytes).toBe(0);
  });

  it('keeps its accounting exact when a key is replaced or expires', () => {
    let now = 0;
    const store = new IdempotencyStore({ maxBytes: 100_000, ttlMs: 10, now: () => now });
    store.record({ ...entry('k', 'x'.repeat(1_000)), storedAt: 0 });
    const first = store.bytes;
    store.record({ ...entry('k', 'x'.repeat(1_000)), storedAt: 0 });
    expect(store.bytes).toBe(first);
    expect(store.size).toBe(1);
    now = 100;
    expect(store.lookup('p', 'd', 'k')).toBeUndefined();
    expect(store.bytes).toBe(0);
  });

  it('has a default large enough for ordinary receipts and small enough to bound memory', () => {
    expect(DEFAULT_IDEMPOTENCY_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(DEFAULT_IDEMPOTENCY_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
