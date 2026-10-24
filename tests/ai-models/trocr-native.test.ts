/** Real-model opt-in regression. Requires the audited graphs/tokenizer/fixture
 * plus cargo build -p varve-bgremove --features ai --example tensor_stdio.
 * Run through heavy-lease. Skipped in ordinary unit runs; no mocks of inference. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TrOcrTokenizer,
  type TrOcrTokenizerJson,
} from '../../packages/engine/src/inference/models/trocrTokenizer';
import {
  recognizeTrOcrLine,
  type TrOcrHost,
} from '../../packages/engine/src/ocrPipeline/trocrRecognition';
import { NativeTensorProcess } from './nativeTensorProcess';

const directory = process.env.VARVE_TROCR_AUDIT_DIR;
const binary = process.env.VARVE_NATIVE_TENSOR_BINARY;

function verified(path: string, hash: string): Buffer {
  const bytes = readFileSync(path);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  return bytes;
}

describe.skipIf(!directory || !binary)('real native TrOCR recognition', () => {
  it('recognizes an actual printed line through the production encoder/decoder and byte vocabulary', async () => {
    const config = JSON.parse(readFileSync(join(directory!, 'input.json'), 'utf8')) as {
      encoder: string;
      decoder: string;
      tokenizer: string;
      rgba: string;
      width: number;
      height: number;
      expected: string;
    };
    verified(config.encoder, '31e9b9a2950c4b0d5d884665414ec3dec36186237955463c07a30e5f3fcd8ea0');
    verified(config.decoder, 'b5f7d6080d4b73256e3364a56e6fe2b558ffc389cb7f0b9166747b126b25a0cd');
    const tokenizer = new TrOcrTokenizer(
      JSON.parse(
        verified(
          config.tokenizer,
          '2f1a555a1ee93656b4e6f67aa75d492a843c225e5ef754bae24c36bd85851cd7',
        ).toString(),
      ) as TrOcrTokenizerJson,
    );
    const sessions = new Map([
      ['trocr-encoder', new NativeTensorProcess(binary!, 'trocr-encoder', config.encoder)],
      ['trocr-decoder', new NativeTensorProcess(binary!, 'trocr-decoder', config.decoder)],
    ]);
    const calls: Array<{ model: string; provider: string | undefined; outputs: string[] }> = [];
    const host: TrOcrHost = {
      infer: async (request, options) => {
        const session = sessions.get(request.modelId);
        if (!session || !request.tensors) throw new Error('Unexpected TrOCR request');
        const reply = await session.run(request.tensors, options.signal);
        calls.push({
          model: request.modelId,
          provider: reply.context.executionProvider,
          outputs: Object.keys(reply.tensors),
        });
        return {
          type: 'result',
          requestId: reply.context.requestId,
          modelType: request.modelType,
          outputs: reply.tensors,
        };
      },
    };
    try {
      const image = new ImageData(
        Uint8ClampedArray.from(readFileSync(config.rgba)),
        config.width,
        config.height,
      );
      const result = await recognizeTrOcrLine(
        image,
        { encoderPath: config.encoder, decoderPath: config.decoder, tokenizer },
        host,
      );
      writeFileSync(join(directory!, 'result.json'), JSON.stringify({ result, calls }, null, 2));
      expect(result.text).toBe(config.expected);
      expect(result.charConfidences).toHaveLength([...result.text].length);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(calls.length).toBeGreaterThan(3);
      expect(calls.every((call) => call.provider === 'native-cpu')).toBe(true);
    } finally {
      await Promise.all([...sessions.values()].map((session) => session.close()));
    }
  }, 240_000);
});
