import type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerTensor,
} from '../inference/inferenceWorker';
import {
  postprocessTrOcr,
  preprocessTrOcr,
  TROCR_MAX_SEQUENCE_LENGTH,
  type TrOcrOutput,
} from '../inference/models/trocr';
import type { TrOcrTokenizer } from '../inference/models/trocrTokenizer';

const LAYERS = 12;
const HEADS = 16;
const KEY_WIDTH = 64;
const VOCABULARY_SIZE = 50_265;
const EOS = 2;

export interface TrOcrResources {
  encoderPath: string;
  decoderPath: string;
  tokenizer: TrOcrTokenizer;
}

export interface TrOcrHost {
  infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<WorkerInferResult>;
}

function floatTensor(
  outputs: Record<string, unknown>,
  name: string,
): WorkerTensor & { data: Float32Array } {
  const output = outputs[name] as WorkerTensor | undefined;
  if (
    !output ||
    !(output.data instanceof Float32Array) ||
    !Array.isArray(output.dims) ||
    output.dims.some((dim) => !Number.isSafeInteger(dim) || dim < 0) ||
    output.dims.reduce((total, dim) => total * dim, 1) !== output.data.length
  ) {
    throw new Error(`TrOCR returned invalid '${name}' tensor`);
  }
  return { data: output.data, dims: output.dims, dtype: 'float32' };
}

function emptyCache(): Record<string, WorkerTensor> {
  const cache: Record<string, WorkerTensor> = {};
  for (let layer = 0; layer < LAYERS; layer++) {
    for (const side of ['decoder', 'encoder']) {
      for (const kind of ['key', 'value']) {
        cache[`past_key_values.${layer}.${side}.${kind}`] = {
          data: new Float32Array(0),
          dims: [1, HEADS, 0, KEY_WIDTH],
        };
      }
    }
  }
  return cache;
}

function advanceCache(
  cache: Record<string, WorkerTensor>,
  outputs: Record<string, unknown>,
  step: number,
): void {
  for (const key of Object.keys(cache)) {
    // The merged cached branch emits empty cross-attention outputs. Retain the
    // first run's encoder KV, rather than feeding those empty tensors back.
    if (step > 0 && key.includes('.encoder.')) continue;
    const present = floatTensor(outputs, key.replace('past_key_values.', 'present.'));
    const length = key.includes('.encoder.') ? 577 : step + 1;
    if (present.dims.join(',') !== [1, HEADS, length, KEY_WIDTH].join(',')) {
      throw new Error(`TrOCR returned an incompatible attention cache for '${key}'`);
    }
    cache[key] = present;
  }
}

function selectToken(outputs: Record<string, unknown>): { id: number; confidence: number } {
  const logits = floatTensor(outputs, 'logits');
  if (
    logits.dims.length !== 3 ||
    logits.dims[0] !== 1 ||
    logits.dims[1]! < 1 ||
    logits.dims[2] !== VOCABULARY_SIZE
  ) {
    throw new Error('TrOCR logits do not match the 50,265-token vocabulary');
  }
  const offset = logits.data.length - VOCABULARY_SIZE;
  let id = 0;
  let maximum = -Infinity;
  for (let index = 0; index < VOCABULARY_SIZE; index++) {
    const value = logits.data[offset + index]!;
    if (!Number.isFinite(value)) throw new Error('TrOCR returned non-finite logits');
    if (value > maximum) {
      maximum = value;
      id = index;
    }
  }
  let denominator = 0;
  for (let index = 0; index < VOCABULARY_SIZE; index++)
    denominator += Math.exp(logits.data[offset + index]! - maximum);
  return { id, confidence: 1 / denominator };
}

/** Greedy autoregressive decoding of the shipped merged INT8 graph. Runs the
 * same named-tensor contract in native ORT and on supported web runtimes. */
export async function recognizeTrOcrLine(
  image: ImageData,
  resources: TrOcrResources,
  host: TrOcrHost,
  signal?: AbortSignal,
  maxLength = TROCR_MAX_SEQUENCE_LENGTH,
): Promise<TrOcrOutput> {
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > TROCR_MAX_SEQUENCE_LENGTH) {
    throw new Error(`TrOCR maximum length must be 1–${TROCR_MAX_SEQUENCE_LENGTH}`);
  }
  signal?.throwIfAborted();
  const { tensor } = preprocessTrOcr(image);
  const encoded = await host.infer(
    {
      type: 'infer',
      modelType: 'trocr',
      modelId: 'trocr-encoder',
      modelPath: resources.encoderPath,
      tensors: { pixel_values: { data: tensor, dims: [1, 3, 384, 384] } },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );
  signal?.throwIfAborted();
  const hidden = floatTensor(encoded.outputs, 'last_hidden_state');
  if (hidden.dims.join(',') !== '1,577,768')
    throw new Error('TrOCR encoder hidden-state shape is incompatible');
  const cache = emptyCache();
  const ids: number[] = [];
  const confidences: number[] = [];
  let next = EOS; // The trained decoder's start token is also EOS.
  for (let step = 0; step < maxLength; step++) {
    signal?.throwIfAborted();
    const decoded = await host.infer(
      {
        type: 'infer',
        modelType: 'trocr',
        modelId: 'trocr-decoder',
        modelPath: resources.decoderPath,
        tensors: {
          ...cache,
          input_ids: { data: BigInt64Array.of(BigInt(next)), dims: [1, 1], dtype: 'int64' },
          encoder_hidden_states: hidden,
          use_cache_branch: { data: Uint8Array.of(step > 0 ? 1 : 0), dims: [1], dtype: 'bool' },
        },
        reuseSession: true,
      },
      { signal, timeoutMs: 60_000 },
    );
    signal?.throwIfAborted();
    const token = selectToken(decoded.outputs);
    if (token.id === EOS) return postprocessTrOcr(ids, confidences, resources.tokenizer);
    ids.push(token.id);
    confidences.push(token.confidence);
    next = token.id;
    advanceCache(cache, decoded.outputs, step);
  }
  throw new Error('TrOCR reached its text-length limit. Use a tighter crop of a single text line.');
}
