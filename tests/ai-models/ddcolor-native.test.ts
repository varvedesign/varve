/** Real DDColor exports through the production native tensor boundary. The
 * fixture is pre-sized to each graph's input, so no canvas shim can manufacture
 * pixels. This qualifies native prediction/reconstruction, not editor IPC.
 * Run under heavy-lease with the audited artifacts and shipped ORT. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineLabToImageData } from '../../packages/engine/src/colorization/colorSpace';
import { packNchwTensor } from '../../packages/engine/src/inference/imageTensor';
import {
  DD_COLOR_TENSOR_SPEC,
  DD_COLOR_TINY_TENSOR_SPEC,
  ddColorInputFromSource,
  decodeDdColorOutput,
} from '../../packages/engine/src/inference/models/ddcolor';
import { rgbToLab } from '../../packages/engine/src/nonSeparable';
import { NativeTensorProcess } from './nativeTensorProcess';

const directory = process.env.VARVE_DDCOLOR_AUDIT_DIR;
const binary = process.env.VARVE_NATIVE_TENSOR_BINARY;

describe.skipIf(!directory || !binary)('real native DDColor prediction', () => {
  it.each(['ddcolor-tiny', 'ddcolor'])(
    '%s returns chroma while retaining source detail and alpha',
    async (modelId) => {
      const config = JSON.parse(readFileSync(join(directory!, `${modelId}.json`), 'utf8')) as {
        path: string;
        sha256: string;
        rgba: string;
      };
      expect(createHash('sha256').update(readFileSync(config.path)).digest('hex')).toBe(
        config.sha256,
      );
      const spec = modelId === 'ddcolor-tiny' ? DD_COLOR_TINY_TENSOR_SPEC : DD_COLOR_TENSOR_SPEC;
      const source = new ImageData(
        Uint8ClampedArray.from(readFileSync(config.rgba)),
        spec.inputWidth,
        spec.inputHeight,
      );
      // Transparent and partial-coverage source pixels must survive rebuilding
      // the color result; neither value changes the raw model's RGB contract.
      source.data[3] = 0;
      source.data[7] = 127;
      const input = packNchwTensor(ddColorInputFromSource(source), spec);
      const native = new NativeTensorProcess(binary!, modelId, config.path);
      try {
        const reply = await native.run({
          input: { data: input, dims: [1, 3, spec.inputHeight, spec.inputWidth] },
        });
        expect(reply.context.executionProvider).toBe('native-cpu');
        const output = reply.tensors.output!;
        expect(output.dims).toEqual([1, 2, spec.inputHeight, spec.inputWidth]);
        expect(output.data).toBeInstanceOf(Float32Array);
        const { a, b } = decodeDdColorOutput(
          output.data as Float32Array,
          spec.inputWidth,
          spec.inputHeight,
          source.width,
          source.height,
        );
        const result = combineLabToImageData(source.data, source.width, source.height, a, b);
        writeFileSync(join(directory!, `${modelId}-output.rgba`), result.data);
        const metrics = measureResult(source, result);
        writeFileSync(
          join(directory!, `${modelId}-result.json`),
          JSON.stringify({ modelSha256: config.sha256, ...reply.context, ...metrics }, null, 2),
        );
        expect(metrics.alphaMismatches).toBe(0);
        expect(metrics.coloredFraction).toBeGreaterThan(0.25);
        expect(metrics.lightnessMae).toBeLessThan(5);
      } finally {
        await native.close();
      }
    },
    180_000,
  );
});

function measureResult(source: ImageData, result: ImageData) {
  let colored = 0;
  let alphaMismatches = 0;
  let lightnessError = 0;
  const pixels = source.width * source.height;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const index = pixel * 4;
    const r = result.data[index]!;
    const g = result.data[index + 1]!;
    const b = result.data[index + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 10) colored++;
    if (result.data[index + 3] !== source.data[index + 3]) alphaMismatches++;
    const [sourceL] = rgbToLab(
      source.data[index]! / 255,
      source.data[index + 1]! / 255,
      source.data[index + 2]! / 255,
    );
    const [resultL] = rgbToLab(r / 255, g / 255, b / 255);
    lightnessError += Math.abs(sourceL - resultL);
  }
  return {
    coloredFraction: colored / pixels,
    lightnessMae: lightnessError / pixels,
    alphaMismatches,
  };
}
