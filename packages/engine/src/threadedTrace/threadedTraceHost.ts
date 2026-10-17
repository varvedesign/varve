/**
 * Threaded trace host — main-thread face of the threaded WASM pool.
 *
 * Contract (threaded-WASM program, ADR-0244 companion work):
 * - Eligibility is the existing capability probe (`threadsUsable`: wasm
 *   validator accepts shared-memory atomics AND SharedArrayBuffer constructs
 *   AND the origin is cross-origin isolated). Without all three the host is
 *   `unavailable` and no worker is ever spawned — the unshared path stays the
 *   default everywhere isolation is off.
 * - The pool lives in one dedicated worker (`tracePoolWorker.ts`); the main
 *   thread never blocks on atomics, pool joins, or a running trace.
 * - `initThreadPool` resolving IS the readiness proof: it resolves only after
 *   every spawned worker posted `wasm_bindgen_worker_ready`. `verifyParallelism`
 *   additionally proves work ran on N distinct workers.
 * - Failures retire the whole pool: after a timeout, a crash, or an error the
 *   worker is terminated and the next request rebuilds from a fresh module
 *   instance. A trapped worker is never trusted again.
 * - Cancellation discards results (synchronous WASM cannot be interrupted);
 *   the worker stays busy until the job completes.
 */

import { resolveAppAssetUrl } from '../assets';
import { getWasmCapabilitySnapshot } from '../runtimeCapabilities';
import type { ThreadedWorkerRequest, ThreadedWorkerResponse } from './tracePoolWorker';

export type ThreadedTracePhase = 'idle' | 'initializing' | 'ready' | 'unavailable' | 'retired';

export interface ThreadedTraceState {
  phase: ThreadedTracePhase;
  /** Why the pool is unavailable/retired; absent while idle/ready. */
  reason?: string;
  /** Requested pool size; equals the real pool size once ready (the pool
   * initializer resolves only after every worker confirmed readiness). */
  threads?: number;
  /** Distinct workers observed running probe jobs (>= 1 once verified). */
  verifiedWorkers?: number;
  abi?: string;
  engineVersion?: string;
  traceVersion?: string;
}

export interface ThreadedTraceOptions {
  threshold?: number;
  minArea?: number;
  foreground?: 'dark' | 'light';
  cornerAngle?: number;
  maxError?: number;
  simplifyTolerance?: number;
}

export interface ThreadedTraceHostConfig {
  /** Directory holding `varve_wasm_threads.js` (+ sibling snippet worker). */
  baseUrl?: string;
  threads?: number;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxPending?: number;
}

export class ThreadedTraceError extends Error {
  readonly kind:
    | 'unavailable'
    | 'invalid-input'
    | 'init-failed'
    | 'timeout'
    | 'worker-crashed'
    | 'backpressure'
    | 'cancelled';

  constructor(kind: ThreadedTraceError['kind'], message: string) {
    super(message);
    this.name = 'ThreadedTraceError';
    this.kind = kind;
  }
}

const DEFAULTS: Required<Omit<ThreadedTraceHostConfig, 'baseUrl'>> & { baseUrl: string } = {
  baseUrl: '',
  // Two workers are the largest configuration currently verified across the
  // isolated browser runtime. Higher hardwareConcurrency does not establish
  // that the browser can provision a larger shared-memory Rayon pool.
  threads: 2,
  initTimeoutMs: 60_000,
  requestTimeoutMs: 120_000,
  maxPending: 4,
};

const MAX_TRACE_PIXELS = 64 * 1024 * 1024;
const MAX_PENDING_TRACE_BYTES = 128 * 1024 * 1024;

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (error: ThreadedTraceError) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ThreadedTraceHost {
  private config: { baseUrl: string } & Required<Omit<ThreadedTraceHostConfig, 'baseUrl'>>;
  private worker: Worker | null = null;
  private pending = new Map<number, PendingRequest>();
  private queue: Array<() => void> = [];
  private busy = false;
  private pendingCount = 0;
  private pendingTraceBytes = 0;
  private nextId = 1;
  private initPromise: Promise<ThreadedTraceState> | null = null;
  private state: ThreadedTraceState = { phase: 'idle' };

  constructor(config?: ThreadedTraceHostConfig) {
    this.config = {
      ...DEFAULTS,
      ...config,
      baseUrl: config?.baseUrl ?? resolveAppAssetUrl('wasm/threads/'),
    };
  }

  getState(): ThreadedTraceState {
    return this.state;
  }

  /** True when the pool is initialized, verified reachable, and not paused. */
  isReady(): boolean {
    return this.state.phase === 'ready';
  }

  /**
   * Initializes the pool once; concurrent callers share the single flight.
   * Resolves with the resulting state — never throws (initialization failure
   * is a state, not an exception, so callers can fall back uniformly).
   */
  ensureReady(): Promise<ThreadedTraceState> {
    if (this.initPromise) return this.initPromise;
    let attempt: Promise<ThreadedTraceState>;
    attempt = this.initialize()
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.setState({ phase: 'unavailable', reason: detail });
        return this.state;
      })
      .then((state) => {
        // Share one in-flight initialization, but allow a later user request
        // to retry after transient startup failures or a missing capability.
        if (state.phase !== 'ready' && this.initPromise === attempt) {
          this.initPromise = null;
        }
        return state;
      });
    this.initPromise = attempt;
    return attempt;
  }

  private setState(state: ThreadedTraceState): void {
    this.state = state;
  }

  private async initialize(): Promise<ThreadedTraceState> {
    const capability = getWasmCapabilitySnapshot().wasm;
    if (!capability.threadsUsable) {
      // No worker spawn attempt without isolation + shared memory: the
      // unshared artifacts remain the only path, by design.
      this.setState({
        phase: 'unavailable',
        reason: 'cross-origin isolation or shared memory unavailable (threadsUsable=false)',
      });
      return this.state;
    }
    if (typeof Worker === 'undefined') {
      this.setState({ phase: 'unavailable', reason: 'Worker constructor unavailable' });
      return this.state;
    }

    this.setState({ phase: 'initializing' });
    const worker = new Worker(new URL('./tracePoolWorker.ts', import.meta.url), {
      type: 'module',
      name: 'varve-threaded-trace-pool',
    });
    this.worker = worker;

    const ready = new Promise<ThreadedTraceState>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onInitMessage);
        worker.removeEventListener('error', onInitError);
        reject(
          new ThreadedTraceError('timeout', `pool init exceeded ${this.config.initTimeoutMs}ms`),
        );
      }, this.config.initTimeoutMs);
      const cleanup = () => clearTimeout(timer);
      const onInitMessage = (event: MessageEvent<ThreadedWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'varve-threaded-error' && message.id === -1) {
          cleanup();
          worker.removeEventListener('message', onInitMessage);
          worker.removeEventListener('error', onInitError);
          reject(new ThreadedTraceError('init-failed', message.error));
          return;
        }
        if (message.type !== 'varve-threaded-ready') return;
        let abi: { abi?: number; engineVersion?: string };
        try {
          abi = JSON.parse(message.abi) as { abi?: number; engineVersion?: string };
        } catch {
          cleanup();
          worker.removeEventListener('message', onInitMessage);
          worker.removeEventListener('error', onInitError);
          reject(
            new ThreadedTraceError('init-failed', 'threaded WASM returned invalid ABI metadata'),
          );
          return;
        }
        if (
          abi.abi !== 1 ||
          abi.engineVersion !== message.engineVersion ||
          message.engineVersion !== message.traceVersion
        ) {
          cleanup();
          worker.removeEventListener('message', onInitMessage);
          worker.removeEventListener('error', onInitError);
          reject(
            new ThreadedTraceError('init-failed', 'threaded WASM asset versions do not match'),
          );
          return;
        }
        cleanup();
        worker.removeEventListener('message', onInitMessage);
        worker.removeEventListener('error', onInitError);
        worker.addEventListener('message', this.handleMessage);
        worker.addEventListener('messageerror', () => {
          if (this.worker === worker) this.retire('worker message deserialization failed');
        });
        worker.addEventListener('error', () => {
          if (this.worker === worker) this.retire('worker crashed');
        });
        this.setState({
          phase: 'ready',
          threads: message.threads,
          abi: message.abi,
          engineVersion: message.engineVersion,
          traceVersion: message.traceVersion,
        });
        resolve(this.state);
      };
      const onInitError = (event: ErrorEvent) => {
        cleanup();
        worker.removeEventListener('message', onInitMessage);
        worker.removeEventListener('error', onInitError);
        reject(new ThreadedTraceError('init-failed', event.message || 'worker error during init'));
      };
      worker.addEventListener('message', onInitMessage);
      worker.addEventListener('error', onInitError);
    });

    try {
      const initMessage: ThreadedWorkerRequest = {
        type: 'varve-threaded-init',
        baseUrl: this.config.baseUrl,
        threads: this.config.threads,
      };
      worker.postMessage(initMessage);
      const state = await ready;
      return state;
    } catch (error) {
      this.terminateWorker();
      const detail = error instanceof Error ? error.message : String(error);
      this.setState({ phase: 'unavailable', reason: detail });
      throw error;
    }
  }

  /**
   * Proves real multi-worker execution: runs one recorded job per chunk in the
   * rayon pool and returns the number of DISTINCT workers that ran jobs.
   * `>= minWorkers` is the threaded-execution acceptance signal.
   */
  async verifyParallelism(minWorkers = 2): Promise<number> {
    const id = this.nextId++;
    const raw = await this.enqueue(async () => {
      const state = await this.ensureReady();
      if (state.phase !== 'ready') {
        throw new ThreadedTraceError('unavailable', state.reason ?? 'pool not ready');
      }
      return this.dispatch(
        {
          type: 'varve-threaded-probe',
          id,
          chunks: Math.max(16, minWorkers * 16),
        },
        [],
      );
    });
    let parsed: { workersUsed?: number[] };
    try {
      parsed = JSON.parse(raw) as { workersUsed?: number[] };
    } catch {
      throw new ThreadedTraceError('worker-crashed', 'probe returned unparsable output');
    }
    const workers = parsed.workersUsed?.length ?? 0;
    this.setState({ ...this.state, verifiedWorkers: workers });
    if (workers < minWorkers) {
      throw new ThreadedTraceError(
        'worker-crashed',
        `probe observed ${workers} distinct worker(s), needed ${minWorkers}`,
      );
    }
    return workers;
  }

  /**
   * Runs a trace in the pool. Resolves with the same JSON shape as the
   * main-thread wasm trace export. Aborted requests resolve/reject like any
   * other and their (uninterruptible) worker-side work is simply discarded.
   */
  async trace(
    pixels: Uint8Array,
    width: number,
    height: number,
    options: ThreadedTraceOptions,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted)
      throw new ThreadedTraceError('cancelled', 'trace canceled before queueing');
    const pixelCount = width * height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isSafeInteger(pixelCount) ||
      pixelCount > MAX_TRACE_PIXELS ||
      pixels.byteLength !== pixelCount * 4
    ) {
      throw new ThreadedTraceError(
        'invalid-input',
        `trace input must be tightly packed RGBA with dimensions from 1 to ${MAX_TRACE_PIXELS} pixels`,
      );
    }
    if (this.pendingCount >= this.config.maxPending) {
      throw new ThreadedTraceError('backpressure', `${this.pendingCount} traces already queued`);
    }
    if (this.pendingTraceBytes + pixels.byteLength > MAX_PENDING_TRACE_BYTES) {
      throw new ThreadedTraceError(
        'backpressure',
        `trace input would exceed ${MAX_PENDING_TRACE_BYTES} queued bytes`,
      );
    }
    // Copy: the caller keeps ownership of its buffer (ImageData-backed views
    // must stay usable); only the copy is transferred into the worker.
    const inputBytes = pixels.byteLength;
    const copy = pixels.slice();
    const id = this.nextId++;
    this.pendingCount += 1;
    this.pendingTraceBytes += inputBytes;
    try {
      return await this.enqueue(async () => {
        if (signal?.aborted) {
          throw new ThreadedTraceError('cancelled', 'trace canceled before dispatch');
        }
        const state = await this.ensureReady();
        if (state.phase !== 'ready' || !this.worker) {
          throw new ThreadedTraceError('unavailable', state.reason ?? 'pool not ready');
        }
        if (signal?.aborted) {
          throw new ThreadedTraceError('cancelled', 'trace canceled before dispatch');
        }
        return this.dispatch(
          {
            type: 'varve-threaded-trace',
            id,
            pixels: copy,
            width,
            height,
            threshold: options.threshold ?? 128,
            minPixels: options.minArea ?? 4,
            foreground: options.foreground ?? 'dark',
            optsJson: JSON.stringify({
              cornerAngle: options.cornerAngle ?? 135,
              maxError: options.maxError ?? 1,
              simplifyTolerance: options.simplifyTolerance ?? 0.75,
            }),
          },
          [copy.buffer],
          signal,
        );
      });
    } finally {
      this.pendingCount -= 1;
      this.pendingTraceBytes -= inputBytes;
    }
  }

  /** Retires the pool; the next `ensureReady` builds a fresh instance. */
  retire(reason: string): void {
    this.terminateWorker();
    this.setState({ phase: 'retired', reason, threads: this.state.threads });
    this.initPromise = null;
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(
        new ThreadedTraceError('worker-crashed', 'pool retired with requests in flight'),
      );
    }
    this.pending.clear();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.busy = true;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.busy = false;
            this.queue.shift()?.();
          });
      };
      if (this.busy) this.queue.push(run);
      else run();
    });
  }

  private dispatch(
    message: ThreadedWorkerRequest,
    transfer: ArrayBuffer[],
    signal?: AbortSignal,
  ): Promise<string> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new ThreadedTraceError('worker-crashed', 'pool worker is gone'));
    }
    const id = 'id' in message && typeof message.id === 'number' ? message.id : this.nextId++;
    return new Promise<string>((resolve, reject) => {
      const settle = (error: ThreadedTraceError) => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending) {
          clearTimeout(pending.timer);
          if (pending.signal && pending.onAbort) {
            pending.signal.removeEventListener('abort', pending.onAbort);
          }
        }
        reject(error);
      };
      const timer = setTimeout(() => {
        // A timed-out request may still be RUNNING (sync wasm cannot be
        // interrupted). The only safe response is retiring the whole pool so
        // stale results can never be adopted and memory is reclaimed. Settle
        // BEFORE retiring: retire() rejects whatever is still pending, and
        // this request's specific error must win that race.
        settle(new ThreadedTraceError('timeout', `request ${id} timed out`));
        this.retire(`request ${id} exceeded ${this.config.requestTimeoutMs}ms`);
      }, this.config.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (signal) {
        const onAbort = () => {
          if (!this.pending.has(id)) return;
          // The export is synchronous; an abort message cannot interrupt it.
          // Terminate its owner to stop the call and discard the pool's shared
          // memory before any later request initializes a clean instance.
          // Settle first so the cancellation is the rejection the caller sees.
          settle(new ThreadedTraceError('cancelled', 'threaded trace canceled'));
          this.retire(`request ${id} canceled`);
        };
        const pending = this.pending.get(id);
        if (pending) {
          pending.signal = signal;
          pending.onAbort = onAbort;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        settle(
          new ThreadedTraceError(
            'worker-crashed',
            error instanceof Error ? error.message : 'postMessage failed',
          ),
        );
      }
    });
  }

  private handleMessage = (event: MessageEvent<ThreadedWorkerResponse>) => {
    const message = event.data;
    if (message.type !== 'varve-threaded-result' && message.type !== 'varve-threaded-error') {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      // A result whose request was already abandoned (abort/retire) is
      // dropped: stopping work and ignoring results are different things,
      // and this is the ignoring half.
      return;
    }
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    this.pending.delete(message.id);
    if (message.type === 'varve-threaded-result') {
      pending.resolve(message.value);
      return;
    }
    pending.reject(new ThreadedTraceError('worker-crashed', message.error));
    this.retire(`worker failed request ${message.id}: ${message.error}`);
  };
}

/** Application-wide host; exists only for diagnostics and the trace provider. */
let sharedHost: ThreadedTraceHost | null = null;

export function getSharedThreadedTraceHost(): ThreadedTraceHost {
  sharedHost ??= new ThreadedTraceHost();
  return sharedHost;
}

/** Test seam: drop the shared host so a later one starts from scratch. */
export function resetSharedThreadedTraceHost(): void {
  sharedHost?.retire('host reset');
  sharedHost = null;
}
