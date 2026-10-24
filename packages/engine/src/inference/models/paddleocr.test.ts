import { describe, expect, it } from 'vitest';
import {
  decodePaddedTextRegions,
  decodeTextRegions,
  padTextDetectionImage,
  padToStride,
} from './paddleocr';

describe('paddleocr', () => {
  it('pads source rows without scaling, dropping or shifting pixels', () => {
    const image = new ImageData(3, 2);
    image.data.set([255, 64, 0, 255], 20);
    const padded = padTextDetectionImage(image);
    expect([padded.width, padded.height]).toEqual([32, 32]);
    expect(padded.data.slice((32 + 2) * 4, (32 + 3) * 4)).toEqual(
      Uint8ClampedArray.of(255, 64, 0, 255),
    );
    expect(padded.data.slice(32 * 2 * 4).every((value) => value === 0)).toBe(true);
  });

  it('clips a border region without changing its source-space origin', () => {
    const data = new Float32Array(32 * 32).fill(1);
    expect(decodePaddedTextRegions(data, 32, 32, 27, 19)).toEqual([
      { x: 0, y: 0, width: 27, height: 19, confidence: 1 },
    ]);
  });
  describe('padToStride', () => {
    it('rounds up to the nearest multiple of the stride', () => {
      expect(padToStride(100, 32)).toBe(128);
      expect(padToStride(64, 32)).toBe(64);
      expect(padToStride(1, 32)).toBe(32);
    });

    it('defaults to stride 32', () => {
      expect(padToStride(33)).toBe(64);
    });
  });

  describe('decodeTextRegions', () => {
    it('expands the DB shrink map so recognition retains complete glyphs', () => {
      // Bounds from the actual failing 432x82 printed-line fixture. The
      // 380x16 shrink box cut both caps and baselines off its 37px glyphs.
      const data = new Float32Array(448 * 96);
      for (let y = 33; y < 49; y++) data.fill(1, y * 448 + 26, y * 448 + 406);
      expect(decodePaddedTextRegions(data, 448, 96, 432, 82)).toEqual([
        { x: 10, y: 17, width: 412, height: 48, confidence: 1 },
      ]);
    });

    it('rejects padding-only regions before expansion can enter source pixels', () => {
      const data = new Float32Array(64 * 32);
      for (let y = 4; y < 20; y++) data.fill(1, y * 64 + 50, y * 64 + 64);
      expect(decodePaddedTextRegions(data, 64, 32, 50, 24)).toEqual([]);
    });

    it('finds a single connected region above the probability threshold', () => {
      const w = 4;
      const h = 4;
      // biome-ignore format: readability of the grid layout
      const data = new Float32Array([
        0, 0, 0, 0,
        0, 1, 1, 0,
        0, 1, 1, 0,
        0, 0, 0, 0,
      ]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.x).toBe(0);
      expect(regions[0]!.y).toBe(0);
      expect(regions[0]!.width).toBe(4);
      expect(regions[0]!.height).toBe(4);
      expect(regions[0]!.confidence).toBeCloseTo(1, 5);
    });

    it('separates two non-adjacent regions', () => {
      const w = 6;
      const h = 2;
      // biome-ignore format: readability of the grid layout
      const data = new Float32Array([
        1, 0, 0, 0, 1, 1,
        1, 0, 0, 0, 1, 1,
      ]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(2);
      // Distinct components remain distinct after their boundaries expand.
      expect(regions[0]!.x).toBe(0);
      expect(regions[0]!.width).toBe(2);
      expect(regions[1]!.x).toBe(3);
      expect(regions[1]!.width).toBe(3);
    });

    it('filters out regions smaller than minRegionArea', () => {
      const w = 4;
      const h = 4;
      const data = new Float32Array(w * h).fill(0);
      data[0] = 1; // single isolated pixel
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 4);
      expect(regions).toHaveLength(0);
    });

    it('scales region coordinates to the target resolution', () => {
      const w = 2;
      const h = 2;
      const data = new Float32Array([1, 1, 1, 1]).fill(1);
      const regions = decodeTextRegions(data, w, h, 8, 4, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.width).toBe(8);
      expect(regions[0]!.height).toBe(4);
    });

    it('averages per-pixel probability into the region confidence', () => {
      const w = 2;
      const h = 1;
      const data = new Float32Array([0.6, 0.8]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.confidence).toBeCloseTo(0.7, 5);
    });
  });
});
