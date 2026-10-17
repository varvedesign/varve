/**
 * Threaded trace pool worker — the single owner of the threaded WASM module
 * and its rayon worker pool.
 *
 * Everything that can block lives here, never on the main thread:
 * module instantiation (shared memory), `initThreadPool` (blocks on atomics
 * while rayon workers bootstrap; browsers forbid `Atomics.wait` on the main
 * thread and a design app must not pay that cost anyway), and the synchronous
 * trace/probe exports themselves.
 *
 * Cancellation semantics are documented, not implied: a synchronous WASM job
 * cannot be interrupted once running. An aborted request's result is
 * discarded by the host; the worker stays busy until the job completes.
 * Hard teardown is the host's `terminate()`, after which the whole pool must
 * be re-initialized from scratch (a trapped worker is never trusted again).
 */

interface InitMessage {
  type: 'varve-threaded-init';
  /** Directory URL holding `varve_wasm_threads.js` and its snippet worker. */
  baseUrl: string;
  threads: number;
}

export interface ThreadedTraceRequestBody {
  type: 'varve-threaded-trace';
  id: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  threshold: number;
  minPixels: number;
  foreground?: string | null;
  optsJson?: string | null;
}

export interface ThreadedProbeRequestBody {
  type: 'varve-threaded-probe';
  id: number;
  chunks: number;
}

export type ThreadedWorkerRequest =
  | InitMessage
  | ThreadedTraceRequestBody
  | ThreadedProbeRequestBody
  | { type: 'varve-threaded-abort-check'; id: number };

export type ThreadedWorkerResponse =
  | {
      type: 'varve-threaded-ready';
      threads: number;
      abi: string;
      engineVersion: string;
      traceVersion: string;
    }
  | { type: 'varve-threaded-result'; id: number; value: string }
  | { type: 'varve-threaded-error'; id: number; error: string };

type ThreadedModule = {
  default: () => Promise<unknown>;
  initThreadPool: (threads: number) => Promise<unknown>;
  threaded_worker_probe: (chunks: number) => string;
  trace_contours_json_opts: (
    pixels: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    minPixels: number,
    foreground?: string | null,
    optsJson?: string | null,
  ) => string;
  wasm_engine_version: () => string;
  wasm_trace_version: () => string;
  wasm_threads_abi: () => string;
};

let modulePromise: Promise<ThreadedModule> | null = null;

async function loadThreadedModule(baseUrl?: string): Promise<ThreadedModule> {
  if (!modulePromise) {
    if (!baseUrl) throw new Error('threaded module requested before init');
    modulePromise = import(
      /* @vite-ignore */ `${baseUrl}varve_wasm_threads.js`
    ) as Promise<ThreadedModule>;
  }
  return modulePromise;
}

async function initialize(baseUrl: string, threads: number): Promise<ThreadedWorkerResponse> {
  const mod = await loadThreadedModule(baseUrl);
  // No argument: the glue resolves `varve_wasm_threads_bg.wasm` against its
  // own URL, so the artifact set is addressed by the one baseUrl.
  await mod.default();
  // Resolves only after every spawned worker posted `wasm_bindgen_worker_ready`;
  // afterwards the pool is real and any exported call may run parallel.
  await mod.initThreadPool(threads);
  return {
    type: 'varve-threaded-ready',
    threads,
    abi: mod.wasm_threads_abi(),
    engineVersion: mod.wasm_engine_version(),
    traceVersion: mod.wasm_trace_version(),
  };
}

// House worker pattern (see outlineWorker.ts): DOM-lib typing means `self`
// is Window-shaped, so posting goes through a Worker cast.
self.onmessage = (event: MessageEvent<ThreadedWorkerRequest>) => {
  const message = event.data;
  void (async () => {
    const post = (response: ThreadedWorkerResponse) =>
      (self as unknown as Worker).postMessage(response);
    try {
      if (message.type === 'varve-threaded-init') {
        post(await initialize(message.baseUrl, message.threads));
        return;
      }
      if (message.type === 'varve-threaded-trace') {
        const mod = await loadThreadedModule();
        post({
          type: 'varve-threaded-result',
          id: message.id,
          value: mod.trace_contours_json_opts(
            message.pixels,
            message.width,
            message.height,
            message.threshold,
            message.minPixels,
            message.foreground ?? null,
            message.optsJson ?? null,
          ),
        });
        return;
      }
      if (message.type === 'varve-threaded-probe') {
        const mod = await loadThreadedModule();
        post({
          type: 'varve-threaded-result',
          id: message.id,
          value: mod.threaded_worker_probe(message.chunks),
        });
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const id = 'id' in message && typeof message.id === 'number' ? message.id : -1;
      post({ type: 'varve-threaded-error', id, error: detail });
    }
  })();
};
