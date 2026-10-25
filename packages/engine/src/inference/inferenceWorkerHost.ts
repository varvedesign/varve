/**
 * Main-thread facade for the generic multi-model inference worker.
 *
 * Manages worker lifecycle, request/response correlation, cancellation,
 * and stale-result rejection via generation tracking.
 */

import { type DerivedResidentLease, isTauriRuntime } from '@varve/platform';
import {
  estimateInferenceReservation,
  getInferenceAdmission,
  type InferenceAdmission,
  type InferenceLease,
} from './admission';
import { InferenceError } from './core/InferenceError';
import type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerReleaseRequest,
  WorkerReleaseResponse,
  WorkerResponse,
  WorkerSessionReady,
  WorkerTensor,
} from './inferenceWorker';
import { estimateModelMemory, getModelById, getRecommendedProvider } from './modelCatalog';
import { NativeWorkerBridge } from './nativeWorkerBridge';
import type { NativeWorkerCall } from './nativeWorkerRuntime';
import type { WorkerSessionIdentity } from './sessionKeys';
import { workerSessionKey } from './sessionKeys';

export interface InferenceJobOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Override the conservative shared-admission estimate when known. */
  reservationBytes?: number;
}

interface PendingJob {
  resolve: (result: WorkerInferResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  admissionLease: InferenceLease;
  sessionKey: string;
  sessionEstimateBytes: number;
  modelId: string;
  /** Release admission only when this worker request is actually finished. */
  finishExecution: () => void;
  callerSettled: boolean;
  abortCleanup?: () => void;
}

interface TrackedSessionResident {
  estimateBytes: number;
  legacyKey: string;
  lease: DerivedResidentLease | null;
}

interface RetiredNativeWorker {
  bridge: NativeWorkerBridge;
  jobs: PendingJob[];
  pending?: Promise<void>;
  error?: Error;
}

// The host deadline covers session creation plus execution. Encoder graphs are
// the expensive cold path; decoder refinements are warm and should recover
// sooner. These are safety ceilings, not UI progress deadlines. Callers may
// still provide a stricter operation-specific deadline.
const MODEL_TIMEOUT_MS: Partial<Record<WorkerInferRequest['modelType'], number>> = {
  'sam2-encoder': 180_000,
  'sam2-decoder': 60_000,
  detr: 120_000,
};
const DEFAULT_TIMEOUT_MS = 120_000;
/** Release confirmation deadline; shorter than inference, longer than a JS turn. */
const RELEASE_TIMEOUT_MS = 30_000;

export class InferenceWorkerHost {
  private worker: Worker | null = null;
  private nativeBridge: NativeWorkerBridge | null = null;
  private retiredNativeWorker: RetiredNativeWorker | null = null;
  private readonly hostId = crypto.randomUUID();
  private workerGeneration = 0;
  private sessionResidents = new Map<string, TrackedSessionResident>();
  private legacySessionKeys = new Map<string, Set<string>>();
  private pendingJobs = new Map<string, PendingJob>();
  private pendingReleases = new Map<
    string,
    {
      resolve: (response: WorkerReleaseResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** Accumulated release evidence; never treats a cache miss as reclaimed bytes. */
  private residency = {
    releasedSessions: 0,
    failedReleases: 0,
    /** Bytes whose release could not be confirmed in the current worker. */
    unresolvedBytes: 0,
    lastReport: null as WorkerReleaseResponse | null,
  };
  private nextRequestId = 0;
  private workerReady = false;

  constructor(
    private workerUrl?: string | URL,
    private admission: InferenceAdmission = getInferenceAdmission(),
  ) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.retiredNativeWorker) throw new Error('Native inference cleanup is still pending');

    this.workerGeneration += 1;

    // The default URL MUST be a literal `new Worker(new URL(...))` expression
    // for Vite to bundle the worker: a URL routed through a variable (or a
    // constructor parameter) is treated as a plain asset, the raw .ts source
    // is emitted with its original extension, and the browser refuses to run
    // it in production builds (the worker dies with an empty error event).
    // See inferenceWorkerHost.ts / vite worker detection.
    if (this.workerUrl) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
    } else {
      this.worker = new Worker(new URL('./inferenceWorker.ts', import.meta.url), {
        type: 'module',
      });
    }
    // A single permanent handler for module readiness, correlated session
    // creation, inference results, and release confirmations. A readiness-only
    // probe would discard failures and resident-session accounting messages.
    const worker = this.worker;
    this.nativeBridge = isTauriRuntime() ? new NativeWorkerBridge() : null;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (this.worker === worker) this.handleMessage(e.data);
    };
    worker.onerror = (e) => {
      if (this.worker === worker) this.handleWorkerError(e);
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.handleWorkerMessageError();
    };

    return this.worker;
  }

  private handleMessage(msg: WorkerResponse): void {
    if (msg.type === 'native-call') {
      this.handleNativeCall(msg);
      return;
    }
    if (msg.type === 'ready') {
      this.workerReady = true;
      return;
    }

    if (msg.type === 'released') {
      const pending = this.pendingReleases.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingReleases.delete(msg.requestId);
      this.residency.lastReport = msg;
      this.residency.releasedSessions += msg.released.length;
      this.residency.failedReleases += msg.failed.length;
      for (const key of msg.released) this.clearSessionResident(key);
      const accountedFailedBytes = msg.snapshot.unresolvedKeys.reduce((sum, key) => {
        const resident = this.sessionResidents.get(key);
        return sum + (resident?.lease ? resident.estimateBytes : 0);
      }, 0);
      this.residency.unresolvedBytes = Math.max(
        0,
        msg.snapshot.unresolvedBytes - accountedFailedBytes,
      );
      pending.resolve(msg);
      return;
    }

    if (msg.type === 'session-ready') {
      this.acceptSessionReady(msg);
      return;
    }

    if (msg.type === 'fatal') {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference worker retired after an unreleased session creation.',
          technical: msg.message,
        }),
      );
      return;
    }

    const job = this.pendingJobs.get(msg.requestId);
    if (!job) return;
    if (this.nativeBridge?.isExecuting(msg.requestId)) {
      this.restartWorker(new Error('Worker completed before its native execution settled'));
      return;
    }

    clearTimeout(job.timer);
    job.abortCleanup?.();
    this.pendingJobs.delete(msg.requestId);

    if (!job.callerSettled) {
      job.callerSettled = true;
      if (msg.type === 'result') {
        job.resolve(msg);
      } else {
        job.reject(inferenceErrorFromMessage(msg.message));
      }
    }
    job.finishExecution();
  }

  private handleNativeCall(message: NativeWorkerCall): void {
    const worker = this.worker;
    const bridge = this.nativeBridge;
    if (!worker || !bridge) {
      this.restartWorker(new Error('Native inference was requested outside the desktop runtime'));
      return;
    }
    bridge.handle(
      message,
      (reply) => {
        if (this.worker !== worker) return;
        try {
          worker.postMessage(reply);
        } catch {
          this.restartWorker(new Error('Native inference reply could not reach its worker'));
        }
      },
      () => {
        if (this.worker !== worker || message.operation === 'release') return false;
        const job = this.pendingJobs.get(message.requestId);
        return !!job && !job.callerSettled && job.modelId === message.modelId;
      },
    );
  }

  private acceptSessionReady(message: WorkerSessionReady): void {
    const job = this.pendingJobs.get(message.requestId);
    if (
      !job ||
      job.sessionKey !== message.sessionKey ||
      job.sessionEstimateBytes !== message.estimateBytes
    ) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference session admission identity did not match its worker result.',
          technical: `Unaccounted or mismatched session '${message.sessionKey}' was reported.`,
        }),
      );
      return;
    }

    for (const key of message.evictedKeys) this.clearSessionResident(key);
    if (this.sessionResidents.has(message.sessionKey)) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference worker recreated a session that the host still tracks.',
          technical: `Duplicate resident identity '${message.sessionKey}'.`,
        }),
      );
      return;
    }

    let residentLease: DerivedResidentLease | null = null;
    try {
      if (message.estimateBytes > 0) {
        residentLease = job.admissionLease.retainResident(message.estimateBytes, {
          key: `inference-session:${message.sessionKey}`,
          priority: 'background',
          onEvict: () => this.evictSession(message.sessionKey),
        });
      }
    } catch (error) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference session could not transfer its reserved bytes to resident ownership.',
          technical: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const legacyKey = workerSessionKey(message.modelType, message.modelPath);
    this.sessionResidents.set(message.sessionKey, {
      estimateBytes: message.estimateBytes,
      legacyKey,
      lease: residentLease,
    });
    const aliases = this.legacySessionKeys.get(legacyKey) ?? new Set<string>();
    aliases.add(message.sessionKey);
    this.legacySessionKeys.set(legacyKey, aliases);
  }

  private async evictSession(sessionKey: string): Promise<boolean> {
    if (!this.sessionResidents.has(sessionKey)) return true;
    try {
      const report = await this.releaseModels([sessionKey]);
      return report.released.includes(sessionKey);
    } catch {
      // A failed IPC release can still coincide with a worker crash. The
      // restart path clears residents only after terminating that owner.
      return !this.sessionResidents.has(sessionKey);
    }
  }

  private clearSessionResident(sessionKey: string): void {
    const resident = this.sessionResidents.get(sessionKey);
    if (!resident) return;
    resident.lease?.release();
    this.sessionResidents.delete(sessionKey);
    const aliases = this.legacySessionKeys.get(resident.legacyKey);
    aliases?.delete(sessionKey);
    if (aliases?.size === 0) this.legacySessionKeys.delete(resident.legacyKey);
  }

  private clearAllSessionResidents(): void {
    for (const resident of this.sessionResidents.values()) resident.lease?.release();
    this.sessionResidents.clear();
    this.legacySessionKeys.clear();
  }

  private handleWorkerError(e: ErrorEvent): void {
    this.restartWorker(
      new InferenceError('worker_crash', undefined, {
        message: `Worker error: ${e.message || 'unknown worker failure'}`,
        technical: e.message || 'unknown worker failure',
      }),
    );
  }

  private handleWorkerMessageError(): void {
    this.restartWorker(
      new InferenceError('worker_crash', undefined, {
        message: 'Worker message could not be deserialized',
        technical: 'Structured clone failed while receiving inference output.',
      }),
    );
  }

  private restartWorker(reason: Error): void {
    if (this.retiredNativeWorker) {
      void this.finishNativeRetirement().catch(() => {});
      return;
    }
    const worker = this.worker;
    const nativeBridge = this.nativeBridge;
    this.worker = null;
    this.nativeBridge = null;
    this.workerReady = false;
    worker?.terminate();
    const jobs = [...this.pendingJobs.values()];
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
      job.abortCleanup?.();
      this.pendingJobs.delete(id);
      if (!job.callerSettled) {
        job.callerSettled = true;
        job.reject(reason);
      }
      if (!nativeBridge) job.finishExecution();
    }
    for (const [id, pending] of this.pendingReleases) {
      clearTimeout(pending.timer);
      this.pendingReleases.delete(id);
      pending.reject(reason);
    }
    if (nativeBridge) {
      // Rust execution and session memory outlive the JavaScript worker. Keep
      // both active and resident leases until native teardown is confirmed.
      this.retiredNativeWorker = { bridge: nativeBridge, jobs };
      void this.finishNativeRetirement().catch(() => {});
      return;
    }
    // Browser resources belong to the terminated worker. Native resources
    // instead require the asynchronous confirmation above.
    this.clearAllSessionResidents();
    this.residency.unresolvedBytes = 0;
  }

  private finishNativeRetirement(): Promise<void> {
    const retired = this.retiredNativeWorker;
    if (!retired) return Promise.resolve();
    if (retired.pending) return retired.pending;
    retired.pending = retired.bridge
      .retire()
      .then(
        () => {
          this.clearAllSessionResidents();
          this.residency.unresolvedBytes = 0;
          this.retiredNativeWorker = null;
          for (const job of retired.jobs) job.finishExecution();
        },
        (error: unknown) => {
          retired.error = error instanceof Error ? error : new Error(String(error));
          throw retired.error;
        },
      )
      .finally(() => {
        retired.pending = undefined;
      });
    return retired.pending;
  }

  /**
   * Stop waiting for one request without tearing down the shared worker.
   *
   * ORT does not expose a portable cancellation hook for every graph, so the
   * computation may finish in the worker. Keep its request, deadline, and
   * admission lease until the late result arrives or the worker is restarted.
   * This prevents a cancelled caller from admitting overlapping work while
   * its original graph still owns CPU/GPU and model memory.
   */
  cancel(requestId: string): boolean {
    const job = this.pendingJobs.get(requestId);
    if (!job || job.callerSettled) return false;
    job.abortCleanup?.();
    job.callerSettled = true;
    this.nativeBridge?.cancel(requestId);
    job.reject(
      new InferenceError('inference_cancelled', undefined, {
        message: 'Inference result discarded after cancellation.',
        technical:
          'The caller stopped waiting; its worker request remains accounted until it finishes.',
        recovery:
          'The result will be discarded. New inference waits for the worker request to finish.',
      }),
    );
    return true;
  }

  async infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: InferenceJobOptions = {},
  ): Promise<WorkerInferResult> {
    if (this.retiredNativeWorker) {
      await waitForNativeCleanup(this.finishNativeRetirement(), options.signal);
    }
    const runtime = isTauriRuntime() ? 'native' : 'web';
    const model = getModelById(request.modelId);
    const sessionEstimateBytes = request.sessionPeakBytes ?? estimateModelMemory(request.modelId);
    if (!Number.isSafeInteger(sessionEstimateBytes) || sessionEstimateBytes < 0) {
      throw new RangeError(
        'Inference session memory estimate must be a non-negative safe integer.',
      );
    }
    const recommendedProvider = getRecommendedProvider(request.modelId);
    const baseSessionIdentity: Omit<WorkerSessionIdentity, 'deviceGeneration'> = {
      ...request.sessionIdentity,
      artifactRevision:
        request.sessionIdentity?.artifactRevision ?? model?.checksum ?? request.modelPath,
      precision: request.sessionIdentity?.precision ?? model?.precision ?? 'unknown',
      providerConfiguration:
        runtime === 'native'
          ? 'native-cpu'
          : (request.sessionIdentity?.providerConfiguration ??
            (recommendedProvider === 'cpu'
              ? 'wasm-only'
              : recommendedProvider === 'gpu'
                ? 'accelerator-with-wasm-fallback'
                : 'runtime-auto')),
      runtimeConfiguration:
        runtime === 'native'
          ? 'ort-native:cpu-arena=off'
          : (request.sessionIdentity?.runtimeConfiguration ?? 'ort-worker:threads=1:proxy=off'),
      externalDataRevision:
        request.sessionIdentity?.externalDataRevision ??
        request.externalData?.checksum ??
        request.externalData?.url,
    };
    const transientBytes = options.reservationBytes ?? estimateWorkerReservation(request);
    let expectedWorkerGeneration = this.worker ? this.workerGeneration : this.workerGeneration + 1;
    let sessionIdentity: WorkerSessionIdentity;
    let sessionKey: string;
    let lease: InferenceLease;
    while (true) {
      sessionIdentity = { ...baseSessionIdentity, deviceGeneration: expectedWorkerGeneration };
      sessionKey = workerSessionKey(request.modelType, request.modelPath, {
        ...sessionIdentity,
        modelId: request.modelId,
        externalDataPath: request.externalData?.path,
      });
      const sessionBytesToReserve = this.sessionResidents.has(sessionKey)
        ? 0
        : sessionEstimateBytes;
      const admissionRequest = {
        kind: 'worker' as const,
        // New sessions are admitted with their model working set plus transient
        // tensors/surfaces. A cached session already owns a resident lease and
        // is therefore not charged twice. Any legacy failed-release bytes that
        // have no matching resident lease remain conservatively reserved.
        reservationBytes: transientBytes + sessionBytesToReserve + this.residency.unresolvedBytes,
        signal: options.signal,
        label: `${request.modelType} inference`,
      };
      lease =
        this.admission.tryAcquire(admissionRequest) ??
        (await this.admission.acquire(admissionRequest));

      const currentWorkerGeneration = this.worker
        ? this.workerGeneration
        : this.workerGeneration + 1;
      if (currentWorkerGeneration === expectedWorkerGeneration) break;

      // The request waited in the shared queue while its worker was retired.
      // Do not post an old-generation key or try transferring bytes that the
      // new worker did not reserve. Re-enter admission for the new identity.
      lease.release();
      expectedWorkerGeneration = currentWorkerGeneration;
    }

    let executionOwned = false;
    try {
      const worker = this.ensureWorker();
      const requestId = `inf_${this.hostId}_${++this.nextRequestId}`;
      const timeout =
        options.timeoutMs ?? MODEL_TIMEOUT_MS[request.modelType] ?? DEFAULT_TIMEOUT_MS;

      return await new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('cancelled'));
          return;
        }

        const timer = setTimeout(() => {
          const job = this.pendingJobs.get(requestId);
          if (!job) return;
          job.abortCleanup?.();
          if (!job.callerSettled) {
            job.callerSettled = true;
            job.reject(
              new InferenceError('inference_timeout', undefined, {
                message: `Inference timed out after ${timeout}ms`,
                technical: `The ${request.modelType} request exceeded the host deadline.`,
              }),
            );
          }
          // Retire the owner. Native teardown keeps the lease until the actual
          // run and session destruction settle, even after worker termination.
          this.restartWorker(
            new InferenceError('worker_crash', undefined, {
              message: 'Inference worker restarted after a timeout.',
              technical:
                'The worker was retired; native execution remains owned until cleanup completes.',
            }),
          );
        }, timeout);

        let finished = false;
        const job: PendingJob = {
          resolve,
          reject,
          timer,
          admissionLease: lease,
          sessionKey,
          sessionEstimateBytes,
          modelId: request.modelId,
          callerSettled: false,
          finishExecution: () => {
            if (finished) return;
            finished = true;
            lease.release();
          },
        };
        this.pendingJobs.set(requestId, job);
        executionOwned = true;

        const fullRequest: WorkerInferRequest = {
          ...request,
          runtime,
          sessionPeakBytes: sessionEstimateBytes,
          sessionIdentity,
          requestId,
        };
        try {
          worker.postMessage(fullRequest);
        } catch (error) {
          clearTimeout(timer);
          job.abortCleanup?.();
          this.pendingJobs.delete(requestId);
          job.callerSettled = true;
          job.finishExecution();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        if (options.signal) {
          const onAbort = () => {
            this.cancel(requestId);
          };
          job.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    } finally {
      // After posting, the response, deadline, or worker teardown releases the
      // lease. Caller cancellation alone leaves the underlying request owned.
      if (!executionOwned) lease.release();
    }
  }

  /**
   * Release a specific model session (or every idle session) before another
   * memory-heavy stage. Returns the worker's actual outcome; callers must use
   * it to decide the next admission step instead of assuming memory returned.
   */
  async releaseModels(
    keys?: readonly string[],
    options: { timeoutMs?: number } = {},
  ): Promise<WorkerReleaseResponse> {
    if (this.retiredNativeWorker) await this.finishNativeRetirement();
    const worker = this.ensureWorker();
    const requestId = `rel_${this.hostId}_${++this.nextRequestId}`;
    const resolvedKeys = keys?.flatMap((key) => {
      const aliases = this.legacySessionKeys.get(key);
      return aliases?.size ? [...aliases] : [key];
    });
    const request: WorkerReleaseRequest = {
      type: 'release',
      requestId,
      ...(resolvedKeys ? { keys: resolvedKeys } : {}),
    };
    const timeout = options.timeoutMs ?? RELEASE_TIMEOUT_MS;
    return new Promise<WorkerReleaseResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReleases.delete(requestId);
        reject(
          new InferenceError('inference_timeout', undefined, {
            message: `Session release timed out after ${timeout}ms`,
            technical: 'The worker did not confirm release; residency stays accounted.',
          }),
        );
      }, timeout);
      this.pendingReleases.set(requestId, { resolve, reject, timer });
      try {
        worker.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pendingReleases.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Release one model identified by the same key the worker cached it under. */
  async releaseModel(
    modelType: WorkerInferRequest['modelType'],
    modelPath: string,
  ): Promise<WorkerReleaseResponse> {
    return this.releaseModels([workerSessionKey(modelType, modelPath)]);
  }

  /** Release evidence for diagnostics and admission decisions. */
  getResidencyDiagnostics(): {
    releasedSessions: number;
    failedReleases: number;
    unresolvedBytes: number;
    residentSessions: number;
    trackedResidentBytes: number;
    pendingReleases: number;
    lastReport: WorkerReleaseResponse | null;
    nativeCleanupPending: boolean;
    nativeCleanupError: string | null;
  } {
    return {
      releasedSessions: this.residency.releasedSessions,
      failedReleases: this.residency.failedReleases,
      unresolvedBytes: this.residency.unresolvedBytes,
      residentSessions: this.sessionResidents.size,
      trackedResidentBytes: [...this.sessionResidents.values()].reduce(
        (sum, resident) => sum + (resident.lease?.bytes ?? 0),
        0,
      ),
      pendingReleases: this.pendingReleases.size,
      lastReport: this.residency.lastReport,
      nativeCleanupPending: this.retiredNativeWorker !== null,
      nativeCleanupError: this.retiredNativeWorker?.error?.message ?? null,
    };
  }

  /**
   * Terminate and lazily recreate the worker, but only when nothing is in
   * flight. This is the bounded fallback when a release failed and the
   * runtime cannot confirm reclamation: worker termination is the only way to
   * return a grown WASM heap, and recycling an idle shared host is safe.
   */
  recycleWorkerIfIdle(): boolean {
    if (this.pendingJobs.size > 0 || this.pendingReleases.size > 0) return false;
    if (this.nativeBridge || this.retiredNativeWorker) {
      this.restartWorker(new Error('Idle native inference worker recycled'));
      return false;
    }
    if (!this.worker) return true;
    this.worker.terminate();
    this.worker = null;
    this.workerReady = false;
    this.clearAllSessionResidents();
    this.residency.unresolvedBytes = 0;
    return true;
  }

  /** Cancel all pending jobs and terminate the worker */
  dispose(): void {
    this.restartWorker(new Error('Worker disposed'));
  }

  get isReady(): boolean {
    return this.workerReady;
  }

  get pendingCount(): number {
    return this.pendingJobs.size;
  }
}

function estimateWorkerReservation(request: Omit<WorkerInferRequest, 'requestId'>): number {
  const tensorBytes = Object.values(request.tensors ?? {}).reduce(
    (total, tensor) => total + tensorByteLength(tensor),
    0,
  );
  const auxBytes = request.auxImageData
    ? request.auxImageData.width * request.auxImageData.height * 4
    : 0;
  if (!request.imageData) {
    return Math.max(1 * 1024 * 1024, tensorBytes * 2 + auxBytes);
  }
  return estimateInferenceReservation({
    width: request.imageData.width,
    height: request.imageData.height,
    outputWidth: request.targetWidth,
    outputHeight: request.targetHeight,
    additionalBytes: auxBytes + tensorBytes,
  });
}

function tensorByteLength(tensor: WorkerTensor): number {
  return tensor.data.byteLength;
}

let sharedHost: InferenceWorkerHost | null = null;

export function getInferenceWorkerHost(): InferenceWorkerHost {
  if (!sharedHost) {
    sharedHost = new InferenceWorkerHost();
  }
  return sharedHost;
}

export function disposeInferenceWorkerHost(): void {
  if (sharedHost) {
    sharedHost.dispose();
    // Retain the cleanup owner so a later request can retry an unconfirmed
    // native release instead of orphaning the session and its reservation.
    if (!sharedHost.getResidencyDiagnostics().nativeCleanupPending) sharedHost = null;
  }
}

function waitForNativeCleanup(cleanup: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return cleanup;
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new InferenceError('inference_cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void cleanup.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function inferenceErrorFromMessage(message: string): Error {
  if (/memory|allocation|out of memory/i.test(message)) {
    return new InferenceError('out_of_memory', undefined, { message, technical: message });
  }
  if (/timed out|timeout/i.test(message)) {
    return new InferenceError('inference_timeout', undefined, { message, technical: message });
  }
  if (/not downloaded|model.*missing|model.*not found/i.test(message)) {
    return new InferenceError('model_not_installed', undefined, { message, technical: message });
  }
  if (/runtime|onnx/i.test(message)) {
    return new InferenceError('runtime_initialisation_failed', undefined, {
      message,
      technical: message,
    });
  }
  return new InferenceError('unknown', undefined, { message, technical: message });
}
