import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerInferRequest, WorkerRequest, WorkerResponse } from '../inferenceWorker';
import type { NativeWorkerCall } from '../nativeWorkerRuntime';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function packedInput(modelType: WorkerInferRequest['modelType'], modelId: string) {
  let feed: Extract<NativeWorkerCall, { operation: 'run' }> | undefined;
  const scope = {
    onmessage: null as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | null,
    postMessage(message: WorkerResponse) {
      if (message.type !== 'native-call') return;
      if (message.operation === 'run') feed = message;
      const result =
        message.operation === 'open'
          ? {
              sessionId: modelId,
              modelId,
              inputNames: ['x'],
              outputNames: ['out'],
              executionProvider: 'native-cpu',
            }
          : message.operation === 'run'
            ? { out: { data: Float32Array.of(1), dims: [1] } }
            : undefined;
      queueMicrotask(() => {
        void scope.onmessage?.({
          data: {
            type: 'native-reply',
            callId: message.callId,
            result,
          },
        } as MessageEvent<WorkerRequest>);
      });
    },
  };
  vi.stubGlobal('self', scope);
  const { __resetSessionCache } = await import('../inferenceWorker');
  __resetSessionCache();
  await scope.onmessage?.({
    data: {
      type: 'infer',
      runtime: 'native',
      requestId: 'pixels',
      modelType,
      modelId,
      modelPath: `/models/${modelId}`,
      reuseSession: true,
      imageData: new ImageData(Uint8ClampedArray.of(255, 128, 0, 255), 1, 1),
    },
  } as MessageEvent<WorkerRequest>);
  await scope.onmessage?.({
    data: { type: 'release', requestId: 'release' },
  } as MessageEvent<WorkerRequest>);
  __resetSessionCache();
  expect(feed).toBeDefined();
  return feed!.tensors.x!.data;
}

describe('dynamic image worker normalization', () => {
  it('preserves the detector ImageNet contract rather than dividing RGB twice', async () => {
    const tensor = await packedInput('paddleocr-det', 'paddleocr-det-v4');
    expect(Number(tensor[0])).toBeCloseTo((1 - 0.485) / 0.229);
    expect(Number(tensor[1])).toBeCloseTo((128 / 255 - 0.456) / 0.224);
    expect(Number(tensor[2])).toBeCloseTo(-0.406 / 0.225);
  });

  it.each([
    ['scunet', 'scunet'],
    ['efficient-sam-encoder', 'efficient-sam-ti-encoder'],
  ] as const)('feeds raw normalized RGB to %s', async (type, id) => {
    const tensor = await packedInput(type, id);
    expect(Number(tensor[0])).toBe(1);
    expect(Number(tensor[1])).toBeCloseTo(128 / 255);
    expect(Number(tensor[2])).toBe(0);
  });
});
