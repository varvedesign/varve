/** Opt-in actual detector/recognizer/worker/Rust integration. Only the host and
 * asset access transport are adapted to Node. No fabricated inference outputs.
 * Requires VARVE_TROCR_AUDIT_DIR and VARVE_NATIVE_TENSOR_BINARY; heavy-lease only. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runOcrPipeline } from '../../packages/engine/src/ocrPipeline/pipeline';
import { type AuditGraph, NativeWorkerProcess } from './nativeWorkerProcess';

const boundary = vi.hoisted(() => ({
  host: null as NativeWorkerProcess | null,
  paths: new Map<string, string>(),
}));
vi.mock('../../packages/engine/src/inference/inferenceWorkerHost', () => ({
  getInferenceWorkerHost: () => boundary.host,
}));
vi.mock('../../packages/engine/src/backgroundRemoval/modelLoader', () => ({
  getModelLoader: () => ({
    getModelPath: async (id: string) => boundary.paths.get(id) ?? null,
  }),
}));

const directory = process.env.VARVE_TROCR_AUDIT_DIR;
const binary = process.env.VARVE_NATIVE_TENSOR_BINARY;
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!directory || !binary)('real native full OCR pipeline', () => {
  it.each(['tr-ocr-base-printed', 'paddleocr-rec-v4'])(
    'recognizes actual detected crops with %s and returns source geometry',
    async (modelId) => {
      vi.resetModules();
      const configFile =
        modelId === 'paddleocr-rec-v4' ? 'paddle-input.json' : 'pipeline-input.json';
      const config = JSON.parse(readFileSync(join(directory!, configFile), 'utf8')) as {
        graphs: Record<string, AuditGraph & { sha256: string }>;
        tokenizer: string;
        dictionary?: string;
        rgba: string;
        width: number;
        height: number;
        expected: string;
      };
      for (const [id, graph] of Object.entries(config.graphs)) {
        expect(createHash('sha256').update(readFileSync(graph.path)).digest('hex')).toBe(
          graph.sha256,
        );
        boundary.paths.set(id, graph.path);
      }
      const tokenizer = readFileSync(config.tokenizer);
      expect(createHash('sha256').update(tokenizer).digest('hex')).toBe(
        '2f1a555a1ee93656b4e6f67aa75d492a843c225e5ef754bae24c36bd85851cd7',
      );
      boundary.paths.set('trocr-tokenizer', 'audit://tokenizer');
      const dictionary = config.dictionary ? readFileSync(config.dictionary) : null;
      if (dictionary) {
        expect(createHash('sha256').update(dictionary).digest('hex')).toBe(
          '28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7',
        );
        boundary.paths.set('paddleocr-keys-v1', 'audit://dictionary');
      }
      vi.stubGlobal('fetch', async (url: string) => {
        if (url === 'audit://dictionary' && dictionary) return new Response(dictionary.toString());
        if (url !== 'audit://tokenizer') throw new Error(`Unexpected network request: ${url}`);
        return new Response(tokenizer.toString());
      });
      const worker = new NativeWorkerProcess(binary!, config.graphs);
      boundary.host = worker;
      vi.stubGlobal('self', worker.scope);
      const { __resetSessionCache } = await import(
        '../../packages/engine/src/inference/inferenceWorker'
      );
      __resetSessionCache();
      try {
        const source = new ImageData(
          Uint8ClampedArray.from(readFileSync(config.rgba)),
          config.width,
          config.height,
        );
        const result = await runOcrPipeline(source, { recognitionModelId: modelId });
        writeFileSync(
          join(directory!, `${modelId}-pipeline-result.json`),
          JSON.stringify({ result, calls: worker.calls }, null, 2),
        );
        expect(result.words.map((word) => word.text).join(' ')).toBe(config.expected);
        expect(result.words.length).toBeGreaterThan(0);
        expect(
          result.words.every(
            (word) =>
              word.x >= 0 &&
              word.y >= 0 &&
              word.x + word.width <= source.width &&
              word.y + word.height <= source.height,
          ),
        ).toBe(true);
        expect(worker.calls.every((call) => call.provider === 'native-cpu')).toBe(true);
        expect(worker.calls.map((call) => call.model)).toContain('paddleocr-det-v4');
      } finally {
        await worker.close();
        __resetSessionCache();
        boundary.host = null;
        boundary.paths.clear();
      }
    },
    240_000,
  );
});
