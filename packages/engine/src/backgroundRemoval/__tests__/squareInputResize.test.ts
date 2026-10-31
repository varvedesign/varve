import { describe, expect, it } from 'vitest';
import { resizeMaskBilinear } from '../maskOps';
import { packModelInput } from '../modelSpec';
import { reconstructModelMask } from '../reconstructMask';
import {
  computeSquareInputTransform,
  computeStretchTransform,
  reconstructSquareInputMask,
  SQUARE_INPUT_LETTERBOX_ASPECT,
  squareInputResizeMode,
} from '../squareInputResize';

describe('squareInputResizeMode', () => {
  it('stretches typical photo ratios and letterboxes only past 2.5:1', () => {
    expect(squareInputResizeMode(800, 600)).toBe('stretch');
    expect(squareInputResizeMode(1920, 1080)).toBe('stretch');
    expect(squareInputResizeMode(600, 800)).toBe('stretch');
    expect(squareInputResizeMode(5, 2)).toBe('stretch');
    expect(squareInputResizeMode(2, 5)).toBe('stretch');
    expect(squareInputResizeMode(6, 2)).toBe('letterbox');
    expect(squareInputResizeMode(2, 6)).toBe('letterbox');
    expect(SQUARE_INPUT_LETTERBOX_ASPECT).toBe(2.5);
  });
});

describe('computeStretchTransform', () => {
  it('maps the full model square onto the source with independent axes', () => {
    const t = computeStretchTransform(800, 400, 320, 320);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
    expect(t.scaleX).toBeCloseTo(320 / 800);
    expect(t.scaleY).toBeCloseTo(320 / 400);
    expect(t.contentWidth).toBe(320);
    expect(t.contentHeight).toBe(320);
  });

  it('throws on zero dimensions', () => {
    expect(() => computeStretchTransform(0, 100, 320, 320)).toThrow('positive');
  });
});

describe('computeSquareInputTransform', () => {
  it('uses stretch geometry for a 2:1 source', () => {
    const t = computeSquareInputTransform(8, 4, 4, 4);
    expect(t.mode).toBe('stretch');
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
    expect(t.scaleX).toBeCloseTo(0.5);
    expect(t.scaleY).toBeCloseTo(1);
  });

  it('uses letterbox geometry for a 4:1 source', () => {
    const t = computeSquareInputTransform(8, 2, 4, 4);
    expect(t.mode).toBe('letterbox');
    expect(t.contentWidth).toBe(4);
    expect(t.contentHeight).toBe(1);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(1);
  });
});

describe('reconstructSquareInputMask', () => {
  it('inverse-stretches a square mask back to the source size', () => {
    const model = new Uint8Array(16);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        model[y * 4 + x] = x < 2 ? 255 : 0;
      }
    }
    const out = reconstructSquareInputMask(model, 4, 4, 8, 4);
    expect(out.length).toBe(32);
    expect(out[0]).toBe(255);
    expect(out[7]).toBe(0);
    expect(out[24]).toBe(255);
    expect(out[31]).toBe(0);
  });

  it('matches resizeMaskBilinear on the stretch path', () => {
    const model = new Uint8Array([0, 255, 0, 255]);
    const viaHelper = reconstructSquareInputMask(model, 2, 2, 4, 2);
    const viaResize = resizeMaskBilinear(model, 2, 2, 4, 2);
    expect(viaHelper).toEqual(viaResize);
  });

  it('uses letterbox reconstruction for an extreme panorama', () => {
    const model = new Uint8Array(16);
    model[4] = 255;
    model[5] = 255;
    model[6] = 255;
    model[7] = 255;
    const transform = computeSquareInputTransform(8, 2, 4, 4);
    expect(transform.mode).toBe('letterbox');
    const out = reconstructSquareInputMask(model, 4, 4, 8, 2);
    const viaLetterbox = reconstructModelMask(model, 4, 4, transform).alpha;
    expect(out).toEqual(viaLetterbox);
  });
});

describe('TS / Rust preprocessing parity contract', () => {
  /**
   * Numbers pinned to crates/varve-bgremove `square_input_*` tests.
   * A 2x1 red/green row stretch-resized conceptually to 2x2 keeps both
   * rows identical; ImageNet packing must match the Rust NCHW loop.
   */
  it('packs ImageNet NCHW the same way as the Rust pack_rgba_nchw helper', () => {
    const spec = {
      inputSize: 2,
      mean: [0.485, 0.456, 0.406] as const,
      std: [0.229, 0.224, 0.225] as const,
      applySigmoid: false,
      paddingRgb: [0, 0, 0] as const,
    };
    const packed = packModelInput(
      {
        data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]),
        width: 2,
        height: 2,
      },
      spec,
    );
    const expected = [
      (1 - 0.485) / 0.229,
      (0 - 0.485) / 0.229,
      (1 - 0.485) / 0.229,
      (0 - 0.485) / 0.229,
      (0 - 0.456) / 0.224,
      (1 - 0.456) / 0.224,
      (0 - 0.456) / 0.224,
      (1 - 0.456) / 0.224,
      (0 - 0.406) / 0.225,
      (0 - 0.406) / 0.225,
      (0 - 0.406) / 0.225,
      (0 - 0.406) / 0.225,
    ];
    expect(packed.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(packed[i]).toBeCloseTo(expected[i]!, 5);
    }
  });
});
