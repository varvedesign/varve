import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetWasmCapabilitySnapshot,
  _setWasmCapabilitySnapshotForTests,
} from '../runtimeCapabilities';
import { resetSharedThreadedTraceHost, ThreadedTraceHost } from './threadedTraceHost';

type Listener = (event: { data?: unknown; message?: string }) => void;

/**
 * Fake pool worker: implements the listener contract the host actually uses
 * (addEventListener for message/error/messageerror) and the real worker's
 * message protocol. Handlers fire on the microtask queue so tests are
 * deterministic under both real and fake timers.
 */
class FakePoolWorker {
  static instances: FakePoolWorker[] = [];
  terminated = false;
  sent: Array<{ message: unknown; transfer: ArrayBuffer[] }> = [];
  failInit = false;
  echoTraces = true;
  probeWorkers = [0, 1, 2];

  private listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakePoolWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown, transfer: ArrayBuffer[] = []): void {
    this.sent.push({ message, transfer });
    const request = message as {
      type: string;
      id?: number;
      threads?: number;
      pixels?: Uint8Array;
    };
    if (request.type === 'varve-threaded-init') {
      queueMicrotask(() => {
        if (this.failInit) {
          this.fire('error', { message: 'simulated init failure' });
          return;
        }
        this.fire('message', {
          data: {
            type: 'varve-threaded-ready',
            threads: request.threads,
            abi: '{"abi":1,"engineVersion":"0.0.0-test"}',
            engineVersion: '0.0.0-test',
            traceVersion: '0.0.0-test',
          },
        });
      });
      return;
    }
    if (request.type === 'varve-threaded-trace') {
      if (!this.echoTraces) return;
      const id = request.id;
      queueMicrotask(() => {
        this.fire('message', {
          data: {
            type: 'varve-threaded-result',
            id,
            value: '{"width":1,"height":1,"paths":[]}',
          },
        });
      });
      return;
    }
    if (request.type === 'varve-threaded-probe') {
      const id = request.id;
      queueMicrotask(() => {
        this.fire('message', {
          data: {
            type: 'varve-threaded-result',
            id,
            value: JSON.stringify({
              workersUsed: this.probeWorkers,
              requestedChunks: 24,
            }),
          },
        });
      });
    }
  }

  fire(type: string, event: { data?: unknown; message?: string }): void {
    if (this.terminated) return;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function getWorker(index = 0): FakePoolWorker {
  const worker = FakePoolWorker.instances[index];
  if (!worker) throw new Error(`fake worker ${index} was not created`);
  return worker;
}

function installFakeWorker(): void {
  vi.stubGlobal('Worker', class extends FakePoolWorker {});
}

const ISOLATED_CAPABILITY = {
  wasm: {
    apiPresent: true,
    baselineValidated: true,
    simdValidated: true,
    threadsValidated: true,
    sharedArrayBufferAvailable: true,
    crossOriginIsolated: true,
    threadsUsable: true,
  },
  workerPresent: true,
  offscreenCanvasPresent: true,
  secureContext: true,
} as const;

beforeEach(() => {
  FakePoolWorker.instances = [];
  _setWasmCapabilitySnapshotForTests({ ...ISOLATED_CAPABILITY });
});

afterEach(() => {
  _resetWasmCapabilitySnapshot();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSharedThreadedTraceHost();
});

describe('ThreadedTraceHost', () => {
  it('stays unavailable without attempting a worker when threads are not usable', async () => {
    _setWasmCapabilitySnapshotForTests({
      wasm: {
        apiPresent: true,
        baselineValidated: true,
        simdValidated: true,
        threadsValidated: false,
        sharedArrayBufferAvailable: false,
        crossOriginIsolated: false,
        threadsUsable: false,
      },
      workerPresent: true,
      offscreenCanvasPresent: true,
      secureContext: true,
    });
    installFakeWorker();
    const host = new ThreadedTraceHost();
    const state = await host.ensureReady();
    expect(state.phase).toBe('unavailable');
    expect(state.reason).toContain('threadsUsable=false');
    expect(FakePoolWorker.instances).toHaveLength(0);
    expect(host.isReady()).toBe(false);
  });

  it('initializes the pool once and reports ready with the handshake facts', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost({ threads: 3 });
    const [a, b] = await Promise.all([host.ensureReady(), host.ensureReady()]);
    expect(a.phase).toBe('ready');
    expect(b).toBe(a);
    expect(FakePoolWorker.instances).toHaveLength(1);
    expect(host.getState().threads).toBe(3);
    expect(host.isReady()).toBe(true);
    const init = getWorker().sent[0]?.message as {
      type: string;
      threads: number;
    };
    expect(init.type).toBe('varve-threaded-init');
    expect(init.threads).toBe(3);
  });

  it('defaults to the validated two-worker pool even on a higher-core browser', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    installFakeWorker();
    const host = new ThreadedTraceHost();
    const state = await host.ensureReady();
    expect(state.phase).toBe('ready');
    expect(state.threads).toBe(2);
  });

  it('rejects invalid dimensions and non-packed RGBA before copying or posting', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost();
    await host.ensureReady();

    await expect(host.trace(new Uint8Array(8), 0, 2, {})).rejects.toMatchObject({
      kind: 'invalid-input',
    });
    await expect(host.trace(new Uint8Array(8), 2, 2, {})).rejects.toMatchObject({
      kind: 'invalid-input',
    });
    expect(
      getWorker().sent.some(
        (entry) => (entry.message as { type: string }).type === 'varve-threaded-trace',
      ),
    ).toBe(false);
  });

  it('survives an init crash as a state, not an exception', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost();
    const pending = host.ensureReady();
    getWorker().failInit = true;
    const state = await pending;
    expect(state.phase).toBe('unavailable');
    expect(state.reason).toContain('simulated init failure');

    const recovered = await host.ensureReady();
    expect(recovered.phase).toBe('ready');
    expect(FakePoolWorker.instances).toHaveLength(2);
  });

  it('copies pixel buffers and discards results for aborted requests', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost();
    await host.ensureReady();
    const worker = getWorker();
    worker.echoTraces = false;
    const pixels = new Uint8Array(16);
    const controller = new AbortController();
    const pending = host.trace(pixels, 2, 2, {}, controller.signal);
    await vi.waitFor(() => {
      expect(
        worker.sent.some(
          (entry) => (entry.message as { type: string }).type === 'varve-threaded-trace',
        ),
      ).toBe(true);
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(worker.terminated).toBe(true);
    expect(host.getState().phase).toBe('retired');

    const sent = worker.sent.find(
      (entry) => (entry.message as { type: string }).type === 'varve-threaded-trace',
    );
    if (!sent) throw new Error('trace message was not posted');
    expect((sent.message as { pixels: Uint8Array }).pixels.buffer).not.toBe(pixels.buffer);
  });

  it('retires the pool after a request timeout and rebuilds fresh afterwards', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost({ requestTimeoutMs: 20 });
    await host.ensureReady();
    const worker = getWorker();
    worker.echoTraces = false; // request never completes

    const pending = host.trace(new Uint8Array(4), 1, 1, {});
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    expect(host.getState().phase).toBe('retired');
    expect(worker.terminated).toBe(true);

    // Next ensureReady builds a NEW worker (a trapped pool is never reused).
    const state = await host.ensureReady();
    expect(state.phase).toBe('ready');
    expect(FakePoolWorker.instances).toHaveLength(2);
  });

  it('rejects with backpressure when the queue is full', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost({ maxPending: 1 });
    await host.ensureReady();
    const worker = getWorker();
    worker.echoTraces = false; // first trace stays in flight

    const first = host.trace(new Uint8Array(4), 1, 1, {});
    await expect(host.trace(new Uint8Array(4), 1, 1, {})).rejects.toMatchObject({
      kind: 'backpressure',
    });
    const traceMessage = worker.sent.find(
      (entry) => (entry.message as { type: string }).type === 'varve-threaded-trace',
    );
    if (!traceMessage) throw new Error('first trace was not posted');
    const id = (traceMessage.message as { id: number }).id;
    worker.fire('message', {
      data: { type: 'varve-threaded-result', id, value: '{"width":1,"height":1,"paths":[]}' },
    });
    await first;
  });

  it('verifies real multi-worker execution through the probe', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost();
    await host.ensureReady();
    const workers = await host.verifyParallelism(2);
    expect(workers).toBe(3);
    expect(host.getState().verifiedWorkers).toBe(3);
  });

  it('throws when the probe observes fewer workers than required', async () => {
    installFakeWorker();
    const host = new ThreadedTraceHost();
    await host.ensureReady();
    getWorker().probeWorkers = [0];
    await expect(host.verifyParallelism(2)).rejects.toMatchObject({ kind: 'worker-crashed' });
  });
});
