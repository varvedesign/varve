/**
 * Tensor buffer exchanged with the inference worker.
 *
 * Kept in this leaf module instead of `inferenceWorker.ts` because the native
 * transport (`nativeWorkerRuntime.ts`) also needs the type: importing it from
 * the worker entrypoint closes a dependency cycle
 * (inferenceWorker → nativeWorkerRuntime → inferenceWorker) that the
 * architecture audit rejects. A leaf module keeps both edges one-directional.
 */
export interface WorkerTensor {
  data: Float32Array | BigInt64Array | Uint8Array;
  /** Defaults to float32; decoder control flags use bool, token ids use int64. */
  dtype?: 'float32' | 'int64' | 'bool';
  dims: number[];
}
