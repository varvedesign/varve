// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerInferRequest, WorkerTensor } from '../inference/inferenceWorker';
import { loadTrOcrTokenizer } from '../inference/models/trocrTokenizer';
import { clearDictionaryCache } from '../inference/ocrDictionary';
import { runOcrPipeline } from './pipeline';
import { recognizeTrOcrLine } from './trocrRecognition';

const boundary = vi.hoisted(() => ({ infer: vi.fn(), getModelPath: vi.fn() }));
vi.mock('../inference/inferenceWorkerHost', () => ({ getInferenceWorkerHost: () => boundary }));
vi.mock('../backgroundRemoval/modelLoader', () => ({ getModelLoader: () => boundary }));

function decoderOutputs(token: number, step: number): Record<string, WorkerTensor> {
  const logits = new Float32Array(50_265).fill(-20);
  logits[token] = 20;
  const outputs: Record<string, WorkerTensor> = { logits: { data: logits, dims: [1, 1, 50_265] } };
  for (let layer = 0; layer < 12; layer++) {
    for (const side of ['decoder', 'encoder']) {
      for (const kind of ['key', 'value']) {
        // Cached cross-attention outputs are empty on subsequent decoder runs.
        const length = side === 'decoder' ? step + 1 : step === 0 ? 577 : 0;
        outputs[`present.${layer}.${side}.${kind}`] = {
          data: new Float32Array(16 * length * 64).fill(layer + 1),
          dims: [1, 16, length, 64],
        };
      }
    }
  }
  return outputs;
}

describe('TrOCR pipeline graph contract', () => {
  beforeEach(() => {
    boundary.getModelPath
      .mockReset()
      .mockImplementation(async (id: string) =>
        id === 'tr-ocr-base-printed' ? null : `asset:///${id}`,
      );
    let step = 0;
    boundary.infer.mockReset().mockImplementation(async (request: WorkerInferRequest) => {
      if (request.modelId === 'paddleocr-det-v4') {
        return {
          outputs: {
            probability: { data: new Float32Array(64).fill(1), dims: [1, 1, 8, 8] },
            executionProvider: 'native-cpu',
          },
        };
      }
      if (request.modelId === 'trocr-encoder') {
        return {
          outputs: {
            last_hidden_state: { data: new Float32Array(577 * 768), dims: [1, 577, 768] },
          },
        };
      }
      if (request.modelId !== 'trocr-decoder') throw new Error('Unexpected graph');
      return { outputs: decoderOutputs([31414, 232, 2][step]!, step++) };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: {
                type: 'BPE',
                vocab: { '<s>': 0, '<pad>': 1, '</s>': 2, Hello: 31414, Ġworld: 232 },
              },
              decoder: { type: 'ByteLevel' },
              added_tokens: [
                { id: 0, special: true },
                { id: 1, special: true },
                { id: 2, special: true },
              ],
            }),
          ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs the physical encoder and autoregressive cached decoder with the matching tokenizer', async () => {
    const progress = vi.fn();
    const result = await runOcrPipeline(new ImageData(64, 32), {
      recognitionModelId: 'tr-ocr-base-printed',
      onProgress: progress,
    });
    expect(result.words[0]?.text).toBe('Hello world');
    expect(result.words[0]?.charConfidences).toHaveLength(11);
    expect(result.words[0]?.detectionConfidence).toBe(1);
    expect(boundary.getModelPath).not.toHaveBeenCalledWith('tr-ocr-base-printed', undefined);
    const calls = boundary.infer.mock.calls.map(([request]) => request as WorkerInferRequest);
    expect(calls.map((request) => request.modelId)).toEqual([
      'paddleocr-det-v4',
      'trocr-encoder',
      'trocr-decoder',
      'trocr-decoder',
      'trocr-decoder',
    ]);
    const first = calls[2]!.tensors!;
    expect(Object.keys(first)).toHaveLength(51);
    expect(first.input_ids?.data).toEqual(BigInt64Array.of(2n));
    expect(first.use_cache_branch).toEqual({ dtype: 'bool', data: Uint8Array.of(0), dims: [1] });
    expect(calls[3]!.tensors!.input_ids?.data).toEqual(BigInt64Array.of(31414n));
    expect(calls[4]!.tensors!['past_key_values.0.encoder.key']?.dims).toEqual([1, 16, 577, 64]);
    expect(progress).toHaveBeenLastCalledWith('done', 1, 1);
  });

  it('propagates decoder failure rather than returning an empty successful recognition', async () => {
    boundary.infer.mockImplementation(async (request: WorkerInferRequest) => ({
      outputs:
        request.modelId === 'paddleocr-det-v4'
          ? { probability: { data: new Float32Array(64).fill(1), dims: [1, 1, 8, 8] } }
          : request.modelId === 'trocr-encoder'
            ? { last_hidden_state: { data: new Float32Array(577 * 768), dims: [1, 577, 768] } }
            : {},
    }));
    await expect(
      runOcrPipeline(new ImageData(64, 32), { recognitionModelId: 'tr-ocr-base-printed' }),
    ).rejects.toThrow(/logits/);
  });

  it('expands the text boundary in source pixels and clips stride padding', async () => {
    const data = new Float32Array(64 * 32);
    for (let y = 8; y < 16; y++) data.fill(1, y * 64 + 40, y * 64 + 48);
    boundary.infer.mockResolvedValue({ outputs: { probability: { data, dims: [1, 1, 32, 64] } } });
    const result = await runOcrPipeline(new ImageData(50, 20), { detectOnly: true });
    expect(result.words[0]).toMatchObject({ x: 36, y: 4, width: 14, height: 16 });
  });

  it('does not turn detections wholly inside stride padding into source text', async () => {
    const data = new Float32Array(64 * 32);
    for (let y = 24; y < 32; y++) data.fill(1, y * 64 + 56, y * 64 + 64);
    boundary.infer.mockResolvedValue({ outputs: { probability: { data, dims: [1, 1, 32, 64] } } });
    const progress = vi.fn();
    const result = await runOcrPipeline(new ImageData(50, 20), { onProgress: progress });
    expect(result.words).toEqual([]);
    expect(progress).toHaveBeenLastCalledWith('done', 0, 0);
  });

  it('does not start acquisition or inference for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runOcrPipeline(new ImageData(64, 32), {
        recognitionModelId: 'tr-ocr-base-printed',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(boundary.getModelPath).not.toHaveBeenCalled();
    expect(boundary.infer).not.toHaveBeenCalled();
  });

  it('discards a cancelled decoder result and stops before the next token', async () => {
    const controller = new AbortController();
    const execute = boundary.infer.getMockImplementation()!;
    boundary.infer.mockImplementation(async (request: WorkerInferRequest) => {
      const result = await execute(request);
      if (request.modelId === 'trocr-decoder') controller.abort();
      return result;
    });
    const progress = vi.fn();
    await expect(
      runOcrPipeline(new ImageData(64, 32), {
        recognitionModelId: 'tr-ocr-base-printed',
        signal: controller.signal,
        onProgress: progress,
      }),
    ).rejects.toThrow(/abort/i);
    expect(boundary.infer.mock.calls.map(([request]) => request.modelId)).toEqual([
      'paddleocr-det-v4',
      'trocr-encoder',
      'trocr-decoder',
    ]);
    expect(progress).not.toHaveBeenCalledWith('done', expect.anything(), expect.anything());
  });

  it('reports a sequence limit instead of returning plausible truncated text', async () => {
    const resources = {
      encoderPath: 'asset:///trocr-encoder',
      decoderPath: 'asset:///trocr-decoder',
      tokenizer: await loadTrOcrTokenizer('asset:///trocr-tokenizer'),
    };
    await expect(
      recognizeTrOcrLine(new ImageData(64, 32), resources, boundary, undefined, 2),
    ).rejects.toThrow(/text-length limit/);
    expect(boundary.infer.mock.calls.map(([request]) => request.modelId)).toEqual([
      'trocr-encoder',
      'trocr-decoder',
      'trocr-decoder',
    ]);
  });
});

describe('PaddleOCR installed resources', () => {
  beforeEach(() => {
    clearDictionaryCache();
    boundary.getModelPath.mockReset().mockImplementation(async (id: string) => `asset:///${id}`);
    boundary.infer.mockReset().mockImplementation(async (request: WorkerInferRequest) => {
      if (request.modelId === 'paddleocr-det-v4')
        return {
          outputs: { probability: { data: new Float32Array(64).fill(1), dims: [1, 1, 8, 8] } },
        };
      const data = new Float32Array(3 * 6625);
      data[1] = 0.9;
      data[6625 + 6624] = 0.95;
      data[2 * 6625 + 2] = 0.9;
      return { outputs: { recognition: { data, dims: [1, 3, 6625] } } };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url !== 'asset:///paddleocr-keys-v1') throw new Error('Network is offline');
        return new Response(['a', 'b', ...Array<string>(6621).fill('z')].join('\n'));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the installed dictionary offline and appends the trained space class', async () => {
    const result = await runOcrPipeline(new ImageData(64, 32));
    expect(result.words[0]?.text).toBe('a b');
    expect(result.dictionaryAvailable).toBe(true);
    expect(boundary.getModelPath).toHaveBeenCalledWith('paddleocr-keys-v1', undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported language instead of silently returning detection-only success', async () => {
    await expect(
      runOcrPipeline(new ImageData(64, 32), { language: 'unsupported' }),
    ).rejects.toThrow(/language/);
    expect(boundary.infer).not.toHaveBeenCalled();
  });
});
