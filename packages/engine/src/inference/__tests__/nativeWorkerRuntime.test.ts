import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerInferRequest, WorkerRequest, WorkerResponse } from '../inferenceWorker';
import type { NativeWorkerCall } from '../nativeWorkerRuntime';

const browserRuntime = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Browser ORT loaded on native request');
  }),
);
vi.mock('onnxruntime-web', browserRuntime);
vi.mock('onnxruntime-web/webgpu', browserRuntime);

afterEach(() => vi.unstubAllGlobals());

describe('worker native session proxy', () => {
  it('uses the native session for successive requests, preserving all output tensors and current cancellation identity', async () => {
    const calls: NativeWorkerCall[] = [];
    const messages: WorkerResponse[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | null,
      postMessage(message: WorkerResponse) {
        messages.push(message);
        if (message.type !== 'native-call') return;
        calls.push(message);
        const result =
          message.operation === 'open'
            ? {
                sessionId: 'native-session',
                modelId: message.modelId,
                inputNames: ['input_ids'],
                outputNames: ['embedding', 'indices'],
                executionProvider: 'native-cpu',
              }
            : message.operation === 'run'
              ? {
                  embedding: { data: Float32Array.of(0.25), dims: [1, 1] },
                  indices: { data: BigInt64Array.of(9007199254740993n), dims: [1], dtype: 'int64' },
                }
              : undefined;
        queueMicrotask(() => {
          void scope.onmessage?.({
            data: { type: 'native-reply', callId: message.callId, result },
          } as MessageEvent<WorkerRequest>);
        });
      },
    };
    vi.stubGlobal('self', scope);
    const { __resetSessionCache } = await import('../inferenceWorker');
    __resetSessionCache();
    const input: WorkerInferRequest = {
      type: 'infer',
      runtime: 'native',
      requestId: 'first',
      modelId: 'siglip-base-patch16-224-text',
      modelType: 'siglip-text',
      modelPath: '/native/text.onnx',
      reuseSession: true,
      tensors: { input_ids: { data: BigInt64Array.of(5n, 8n), dims: [1, 2], dtype: 'int64' } },
    };
    await scope.onmessage?.({ data: input } as MessageEvent<WorkerRequest>);
    await scope.onmessage?.({
      data: { ...input, requestId: 'second' },
    } as MessageEvent<WorkerRequest>);
    const runs = calls.filter((call) => call.operation === 'run');
    expect(runs.map((call) => call.requestId)).toEqual(['first', 'second']);
    expect(runs[0]?.tensors.input_ids?.data).toEqual(BigInt64Array.of(5n, 8n));
    expect(calls.filter((call) => call.operation === 'open')).toHaveLength(1);
    expect(messages.filter((message) => message.type === 'result')).toEqual([
      expect.objectContaining({
        requestId: 'first',
        outputs: expect.objectContaining({
          executionProvider: 'native-cpu',
          indices: expect.objectContaining({
            data: BigInt64Array.of(9007199254740993n),
            dtype: 'int64',
          }),
        }),
      }),
      expect.objectContaining({ requestId: 'second' }),
    ]);
    expect(browserRuntime).not.toHaveBeenCalled();
    await scope.onmessage?.({
      data: { type: 'release', requestId: 'release' },
    } as MessageEvent<WorkerRequest>);
    expect(calls.at(-1)).toMatchObject({ operation: 'release', sessionId: 'native-session' });
    expect(messages.at(-1)).toMatchObject({ type: 'released', remaining: 0 });
    __resetSessionCache();
  });
});
