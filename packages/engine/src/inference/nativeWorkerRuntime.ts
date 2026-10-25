/** Real native session proxy. This module only transports tensors; Rust ORT
 * creates, executes and destroys the sessions. No web runtime is loaded. */

import { SessionCleanupFailedError } from './core/sessionCreation';
import type { WorkerTensor } from './workerTensor';

export interface NativeSessionInfo {
  sessionId: string;
  modelId: string;
  inputNames: string[];
  outputNames: string[];
  executionProvider: string;
}

export type NativeWorkerCall = { type: 'native-call'; callId: string } & (
  | { operation: 'open'; requestId: string; modelId: string }
  | {
      operation: 'run';
      requestId: string;
      modelId: string;
      sessionId: string;
      tensors: Record<string, WorkerTensor>;
    }
  | { operation: 'release'; sessionId: string }
);

export interface NativeWorkerReply {
  type: 'native-reply';
  callId: string;
  result?: unknown;
  error?: string;
  fatal?: boolean;
}

const pending = new Map<
  string,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>();
let nextId = 0;

function call<T>(
  operation:
    | Omit<Extract<NativeWorkerCall, { operation: 'open' }>, 'type' | 'callId'>
    | Omit<Extract<NativeWorkerCall, { operation: 'run' }>, 'type' | 'callId'>
    | Omit<Extract<NativeWorkerCall, { operation: 'release' }>, 'type' | 'callId'>,
): Promise<T> {
  const callId = `native_${++nextId}`;
  return new Promise<T>((resolve, reject) => {
    pending.set(callId, { resolve: (value) => resolve(value as T), reject });
    try {
      self.postMessage({ ...operation, type: 'native-call', callId } satisfies NativeWorkerCall);
    } catch (error) {
      pending.delete(callId);
      reject(error);
    }
  });
}

export function acceptNativeReply(reply: NativeWorkerReply): void {
  const entry = pending.get(reply.callId);
  if (!entry) return;
  pending.delete(reply.callId);
  if (reply.error)
    entry.reject(reply.fatal ? new SessionCleanupFailedError(reply.error) : new Error(reply.error));
  else entry.resolve(reply.result);
}

export class NativeWorkerTensor implements WorkerTensor {
  readonly data: Float32Array | BigInt64Array | Uint8Array;
  readonly dtype: 'float32' | 'int64' | 'bool';
  constructor(
    dtype: string,
    data: ArrayLike<number> | BigInt64Array,
    readonly dims: number[],
  ) {
    if (
      (dtype === 'float32' && data instanceof Float32Array) ||
      (dtype === 'int64' && data instanceof BigInt64Array) ||
      (dtype === 'bool' && data instanceof Uint8Array)
    ) {
      this.data = data;
      this.dtype = dtype;
    } else {
      throw new Error('Unsupported native input tensor type');
    }
  }
}

export interface NativeWorkerSession {
  inputNames: string[];
  outputNames: string[];
  executionProvider: string;
  run: (feeds: Record<string, unknown>, requestId: string) => Promise<Record<string, WorkerTensor>>;
  release: () => Promise<void>;
}

export async function openNativeWorkerSession(
  modelId: string,
  requestId: string,
): Promise<NativeWorkerSession> {
  const info = await call<NativeSessionInfo>({ operation: 'open', modelId, requestId });
  return {
    inputNames: info.inputNames,
    outputNames: info.outputNames,
    executionProvider: info.executionProvider,
    async run(feeds, ownerRequestId) {
      const tensors: Record<string, WorkerTensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        if (!(tensor instanceof NativeWorkerTensor)) throw new Error('Invalid native tensor feed');
        tensors[name] = { data: tensor.data, dims: tensor.dims, dtype: tensor.dtype };
      }
      return call<Record<string, WorkerTensor>>({
        operation: 'run',
        modelId,
        requestId: ownerRequestId,
        sessionId: info.sessionId,
        tensors,
      });
    },
    release: () => call<void>({ operation: 'release', sessionId: info.sessionId }),
  };
}
