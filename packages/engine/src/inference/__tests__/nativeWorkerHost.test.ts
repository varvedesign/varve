import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InferenceAdmission } from '../admission';
import type { WorkerInferRequest } from '../inferenceWorker';
import { InferenceWorkerHost } from '../inferenceWorkerHost';
import { decodeNativeTensors, encodeNativeTensors } from '../nativeTensorWire';
import type { NativeSessionInfo } from '../nativeWorkerRuntime';
import { workerSessionKey } from '../sessionKeys';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: Array<WorkerInferRequest | { type: string; callId?: string; error?: string }> = [];
  terminated = false;
  constructor() {
    WorkerDouble.instances.push(this);
  }
  postMessage(message: WorkerDouble['posted'][number]) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const modelId = 'siglip-base-patch16-224-text';
const request: Omit<WorkerInferRequest, 'requestId'> = {
  type: 'infer',
  modelId,
  modelType: 'siglip-text',
  modelPath: '/native/siglip.onnx',
  sessionPeakBytes: 100,
  tensors: { input_ids: { data: BigInt64Array.of(1n, 2n), dims: [1, 2], dtype: 'int64' } },
};
const session: NativeSessionInfo = {
  modelId,
  sessionId: 'session-one',
  inputNames: ['input_ids'],
  outputNames: ['embedding'],
  executionProvider: 'native-cpu',
};
const hosts: InferenceWorkerHost[] = [];

function start(options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const admission = new InferenceAdmission({ maxConcurrent: 1 });
  const host = new InferenceWorkerHost('about:blank', admission);
  hosts.push(host);
  const pending = host.infer(request, { reservationBytes: 20, ...options });
  const worker = WorkerDouble.instances.at(-1)!;
  const sent = worker.posted[0] as WorkerInferRequest;
  return { host, admission, pending, worker, sent };
}

async function open(h: ReturnType<typeof start>) {
  h.worker.emit({
    type: 'native-call',
    operation: 'open',
    callId: 'open',
    requestId: h.sent.requestId,
    modelId,
  });
  await vi.waitFor(() =>
    expect(h.worker.posted).toContainEqual(
      expect.objectContaining({ type: 'native-reply', callId: 'open', result: session }),
    ),
  );
  h.worker.emit({
    type: 'session-ready',
    requestId: h.sent.requestId,
    modelType: request.modelType,
    modelPath: request.modelPath,
    sessionKey: workerSessionKey(request.modelType, request.modelPath, {
      ...h.sent.sessionIdentity,
      modelId,
    }),
    estimateBytes: 100,
    evictedKeys: [],
  });
}

function run(h: ReturnType<typeof start>) {
  h.worker.emit({
    type: 'native-call',
    operation: 'run',
    callId: 'run',
    requestId: h.sent.requestId,
    modelId,
    sessionId: session.sessionId,
    tensors: request.tensors,
  });
}

beforeEach(() => {
  WorkerDouble.instances = [];
  vi.stubGlobal('Worker', WorkerDouble);
  vi.stubGlobal('window', { __TAURI__: {}, __TAURI_INTERNALS__: {} });
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'open_native_tensor_session') return session;
    return undefined;
  });
});

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop worker native execution ownership', () => {
  it('selects native execution and forwards named int64 tensors with verified provenance', async () => {
    const h = start();
    // Attach rejection immediately: the pre-fix host mistakes native-call for a terminal error.
    const result = h.pending.catch((error: unknown) => error);
    expect(h.sent).toMatchObject({ runtime: 'native' });
    await open(h);
    native.invoke.mockImplementation(async (command: string, packet: Uint8Array) => {
      if (command !== 'run_native_tensor_session') return;
      const decoded = decodeNativeTensors(packet.buffer as ArrayBuffer);
      expect(decoded.tensors.input_ids?.data).toEqual(BigInt64Array.of(1n, 2n));
      return encodeNativeTensors(
        { ...decoded.context, executionProvider: 'native-cpu' },
        {
          embedding: { data: Float32Array.of(0.25, -0.5), dims: [1, 2] },
        },
      ).buffer;
    });
    run(h);
    await vi.waitFor(() =>
      expect(h.worker.posted).toContainEqual(
        expect.objectContaining({
          callId: 'run',
          result: expect.objectContaining({ embedding: expect.objectContaining({ dims: [1, 2] }) }),
        }),
      ),
    );
    h.worker.emit({
      type: 'result',
      requestId: h.sent.requestId,
      outputs: { executionProvider: 'native-cpu' },
    });
    await expect(result).resolves.toMatchObject({ type: 'result' });
  });

  it('keeps native execution and residency owned after timeout until run and destruction finish', async () => {
    vi.useFakeTimers();
    const execution = deferred<ArrayBuffer>();
    const destruction = deferred<void>();
    const h = start({ timeoutMs: 1000 });
    const rejection = expect(h.pending).rejects.toMatchObject({ code: 'inference_timeout' });
    await open(h);
    native.invoke.mockImplementation((command: string) =>
      command === 'run_native_tensor_session'
        ? execution.promise
        : command === 'release_native_tensor_session'
          ? destruction.promise
          : Promise.resolve(),
    );
    run(h);
    await vi.advanceTimersByTimeAsync(1001);
    await rejection;
    expect(h.worker.terminated).toBe(true);
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      reservedBytes: 120,
      residentBytes: 100,
    });
    expect(native.invoke).toHaveBeenCalledWith('cancel_native_tensor_inference', {
      requestId: h.sent.requestId,
    });
    execution.reject(new Error('cancelled by native runtime'));
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith('release_native_tensor_session', {
        sessionId: session.sessionId,
      }),
    );
    expect(h.admission.getSnapshot().reservedBytes).toBe(120);
    destruction.resolve();
    await vi.waitFor(() => expect(h.admission.getSnapshot().reservedBytes).toBe(0));
  });

  it('does not free admission when a worker crashes during native session loading', async () => {
    const loading = deferred<NativeSessionInfo>();
    const destruction = deferred<void>();
    native.invoke.mockImplementation((command: string) =>
      command === 'open_native_tensor_session'
        ? loading.promise
        : command === 'release_native_tensor_session'
          ? destruction.promise
          : Promise.resolve(),
    );
    const h = start();
    const rejection = expect(h.pending).rejects.toMatchObject({ code: 'worker_crash' });
    h.worker.emit({
      type: 'native-call',
      operation: 'open',
      callId: 'open',
      requestId: h.sent.requestId,
      modelId,
    });
    h.worker.onerror?.({ message: 'crashed while loading' });
    await rejection;
    expect(h.admission.getSnapshot().reservedBytes).toBe(120);
    loading.resolve(session);
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith('release_native_tensor_session', {
        sessionId: session.sessionId,
      }),
    );
    expect(h.admission.getSnapshot().reservedBytes).toBe(120);
    destruction.resolve();
    await vi.waitFor(() => expect(h.admission.getSnapshot().reservedBytes).toBe(0));
  });

  it('refuses an unadmitted model request before invoking native code', async () => {
    const h = start();
    const result = h.pending.catch((error: unknown) => error);
    h.worker.emit({
      type: 'native-call',
      operation: 'open',
      callId: 'wrong-model',
      requestId: h.sent.requestId,
      modelId: 'unrequested-model',
    });
    await vi.waitFor(() =>
      expect(h.worker.posted).toContainEqual(
        expect.objectContaining({
          type: 'native-reply',
          callId: 'wrong-model',
          error: expect.any(String),
        }),
      ),
    );
    expect(native.invoke).not.toHaveBeenCalled();
    h.host.dispose();
    await result;
  });

  it('cancels native execution while retaining admission and discarding the late tensor result', async () => {
    const controller = new AbortController();
    const execution = deferred<ArrayBuffer>();
    const h = start({ signal: controller.signal });
    const rejection = expect(h.pending).rejects.toMatchObject({ code: 'inference_cancelled' });
    await open(h);
    native.invoke.mockImplementation((command: string) =>
      command === 'run_native_tensor_session' ? execution.promise : Promise.resolve(),
    );
    run(h);
    controller.abort();
    await rejection;
    expect(h.worker.terminated).toBe(false);
    expect(h.admission.getSnapshot()).toMatchObject({ active: 1, reservedBytes: 120 });
    execution.resolve(
      encodeNativeTensors(
        {
          requestId: h.sent.requestId,
          sessionId: session.sessionId,
          modelId,
          executionProvider: 'native-cpu',
        },
        {
          embedding: { dims: [1], data: Float32Array.of(1) },
        },
      ).buffer as ArrayBuffer,
    );
    await vi.waitFor(() =>
      expect(h.worker.posted).toContainEqual(
        expect.objectContaining({ callId: 'run', error: 'Inference cancelled' }),
      ),
    );
    h.worker.emit({ type: 'error', requestId: h.sent.requestId, message: 'Inference cancelled' });
    expect(h.admission.getSnapshot()).toMatchObject({ active: 0, residentBytes: 100 });
    h.host.dispose();
    await vi.waitFor(() => expect(h.admission.getSnapshot().reservedBytes).toBe(0));
  });

  it('retains residency after failed native destruction and retries cleanup before a new worker', async () => {
    const h = start();
    await open(h);
    h.worker.emit({ type: 'result', requestId: h.sent.requestId, outputs: {} });
    await h.pending;
    native.invoke.mockRejectedValue(new Error('release unavailable'));
    h.host.dispose();
    await vi.waitFor(() =>
      expect(h.host.getResidencyDiagnostics().nativeCleanupError).toContain('release unavailable'),
    );
    expect(h.admission.getSnapshot().residentBytes).toBe(100);
    expect(WorkerDouble.instances).toHaveLength(1);
    native.invoke.mockResolvedValue(undefined);
    const retry = h.host.infer(request, { reservationBytes: 20 });
    await vi.waitFor(() => expect(WorkerDouble.instances).toHaveLength(2));
    const replacement = WorkerDouble.instances[1]!;
    const sent = replacement.posted[0] as WorkerInferRequest;
    expect(h.admission.getSnapshot()).toMatchObject({
      active: 1,
      residentBytes: 0,
      reservedBytes: 120,
    });
    replacement.emit({ type: 'result', requestId: sent.requestId, outputs: {} });
    await retry;
  });

  it('rejects a native tensor response for a different model', async () => {
    const h = start();
    const result = h.pending.catch((error: unknown) => error);
    await open(h);
    native.invoke.mockResolvedValue(
      encodeNativeTensors(
        {
          requestId: h.sent.requestId,
          sessionId: session.sessionId,
          modelId: 'different-model',
          executionProvider: 'native-cpu',
        },
        {
          embedding: { dims: [1], data: Float32Array.of(1) },
        },
      ).buffer,
    );
    run(h);
    await vi.waitFor(() =>
      expect(h.worker.posted).toContainEqual(
        expect.objectContaining({
          callId: 'run',
          error: 'Native inference result identity mismatch',
        }),
      ),
    );
    h.worker.emit({
      type: 'error',
      requestId: h.sent.requestId,
      message: 'Native inference result identity mismatch',
    });
    await expect(result).resolves.toBeInstanceOf(Error);
  });
});
