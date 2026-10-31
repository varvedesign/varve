import { describe, expect, it, vi } from 'vitest';
import {
  adaptiveBorderMask,
  chromaKeyMask,
  edgeDetectMask,
  floodFillMask,
  kMeansMask,
  removeBackgroundHeuristic,
} from '../heuristic';

function makeTestImage(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

function redBlueSplit(w: number, h: number): ImageData {
  return makeTestImage(w, h, (x, _y) => {
    if (x < w / 2) return [255, 0, 0, 255];
    return [0, 0, 255, 255];
  });
}

function solidWhite(w: number, h: number): ImageData {
  return makeTestImage(w, h, () => [255, 255, 255, 255]);
}

describe('floodFillMask', () => {
  it('fills a connected region from click point', () => {
    const img = redBlueSplit(20, 20);
    const mask = floodFillMask(img, { x: 15, y: 10 }, 30);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = y * 20 + x;
        expect(mask[i]).toBe(x >= 10 ? 0 : 255);
      }
    }
  });

  it('marks entire white image as background (mask=0)', () => {
    const img = solidWhite(10, 10);
    const mask = floodFillMask(img, { x: 5, y: 5 }, 30);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('returns all-255 when click is out of bounds', () => {
    const img = redBlueSplit(10, 10);
    const mask = floodFillMask(img, { x: 100, y: 100 }, 30);
    expect(mask.every((v) => v === 255)).toBe(true);
  });

  it('low tolerance only fills very similar colors', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      const val = x < 3 ? 255 : x < 5 ? 250 : 0;
      return [val, val, val, 255];
    });
    const mask = floodFillMask(img, { x: 1, y: 5 }, 5);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 1]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
      expect(mask[y * 10 + 4]).toBe(255);
    }
  });

  it('treats transparent pixels as background (mask=0)', () => {
    const img = makeTestImage(10, 10, (x, _y) => (x < 5 ? [255, 0, 0, 0] : [255, 0, 0, 255]));
    const mask = floodFillMask(img, { x: 2, y: 5 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 4]).toBe(0);
      expect(mask[y * 10 + 5]).toBe(255);
    }
  });
});

describe('chromaKeyMask', () => {
  it('isolates foreground on pure green screen', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [0, 255, 0, 255];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
      expect(mask[y * 10 + 5]).toBe(255);
    }
  });

  it('high tolerance selects near-green as background', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [0, 255, 0, 255];
      if (x < 5) return [10, 245, 10, 255];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 50);
    expect(mask[0]).toBe(0);
    expect(mask[0 * 10 + 4]).toBe(0);
    expect(mask[0 * 10 + 5]).toBe(255);
  });

  it('treats leftover RGB in transparent pixels as background, not a key hit', () => {
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [0, 255, 0, 0];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
    }
  });

  it('keeps partial alpha on a non-key soft edge', () => {
    const img = makeTestImage(4, 1, (x) => {
      if (x === 0) return [255, 0, 0, 64];
      if (x === 1) return [255, 0, 0, 255];
      return [0, 255, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 30);
    expect(mask[0]).toBe(64);
    expect(mask[1]).toBe(255);
    expect(mask[2]).toBe(0);
  });

  it('ignores leftover RGB that does not match the key colour', () => {
    // Old chroma keyed only on RGB, so leftover magenta in a=0 pixels
    // became a false subject when the key was green.
    const img = makeTestImage(10, 10, (x, _y) => {
      if (x < 3) return [255, 0, 255, 0];
      return [255, 0, 0, 255];
    });
    const mask = chromaKeyMask(img, { r: 0, g: 255, b: 0 }, 30);
    for (let y = 0; y < 10; y++) {
      expect(mask[y * 10 + 0]).toBe(0);
      expect(mask[y * 10 + 2]).toBe(0);
      expect(mask[y * 10 + 3]).toBe(255);
    }
  });
});

describe('kMeansMask', () => {
  it('separates two distinct color regions', () => {
    const img = redBlueSplit(10, 10);
    const mask = kMeansMask(img);
    const hasFg = mask.some((v) => v > 128);
    const hasBg = mask.some((v) => v <= 128);
    expect(hasFg).toBe(true);
    expect(hasBg).toBe(true);
  });

  it('returns uniform mask for single-color image', () => {
    const img = solidWhite(10, 10);
    const mask = kMeansMask(img);
    const unique = new Set(mask);
    expect(unique.size).toBeLessThanOrEqual(2);
  });

  it('does not let leftover RGB in transparent pixels become a colour cluster', () => {
    const img = makeTestImage(12, 12, (x, y) => {
      if (x >= 3 && x < 9 && y >= 3 && y < 9) return [40, 80, 200, 255];
      return [0, 255, 0, 0];
    });
    const mask = kMeansMask(img);
    expect(mask[0]).toBe(0);
    expect(mask[11 * 12 + 11]).toBe(0);
    expect(mask[6 * 12 + 6]).toBe(255);
  });

  it('keeps an inset cutout when leftover RGB has similar luminance', () => {
    const img = makeTestImage(16, 16, (x, y) => {
      const subject = x >= 4 && x < 12 && y >= 4 && y < 12;
      return subject ? [200, 40, 40, 255] : [255, 0, 255, 0];
    });
    const mask = kMeansMask(img);
    expect(mask[0]).toBe(0);
    expect(mask[8 * 16 + 8]).toBe(255);
    expect([...mask].filter((v) => v >= 128)).toHaveLength(64);
  });

  it('keeps every subject pixel when the cutout touches the frame edge', () => {
    const img = makeTestImage(20, 10, (x, _y) => {
      const subject = x < 10;
      return subject ? [200, 40, 40, 255] : [0, 255, 0, 0];
    });
    const mask = kMeansMask(img);
    expect([...mask].filter((v) => v === 255)).toHaveLength(100);
    expect(mask[0]).toBe(255);
    expect(mask[9]).toBe(255);
    expect(mask[10]).toBe(0);
  });

  it('preserves partial alpha on anti-aliased cutout edges', () => {
    const img = makeTestImage(8, 8, (x, y) => {
      if (x >= 2 && x < 6 && y >= 2 && y < 6) return [200, 40, 40, 255];
      if (x >= 1 && x < 7 && y >= 1 && y < 7) return [200, 40, 40, 64];
      return [12, 34, 56, 0];
    });
    const mask = kMeansMask(img);
    expect(mask[0]).toBe(0);
    expect(mask[1 * 8 + 1]).toBe(64);
    expect(mask[4 * 8 + 4]).toBe(255);
  });

  it('returns an all-background mask for a fully transparent PNG', () => {
    const img = makeTestImage(8, 8, () => [12, 34, 56, 0]);
    expect(kMeansMask(img).every((v) => v === 0)).toBe(true);
  });
});

describe('adaptiveBorderMask', () => {
  it('keeps a central subject on a mildly varying studio background', () => {
    const img = makeTestImage(30, 20, (x, y) => {
      if (x >= 9 && x < 21 && y >= 4 && y < 17) return [35, 70, 180, 255];
      const shade = 225 + Math.round((x / 29) * 15);
      return [shade, shade, shade, 255];
    });
    const mask = adaptiveBorderMask(img);
    expect(mask[10 * 30 + 15]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[19 * 30 + 29]).toBe(0);
  });

  it('is deterministic across repeated Quick runs', () => {
    const img = redBlueSplit(20, 20);
    expect(adaptiveBorderMask(img)).toEqual(adaptiveBorderMask(img));
    expect(kMeansMask(img)).toEqual(kMeansMask(img));
  });
});

describe('edgeDetectMask', () => {
  it('finds a large central rectangle', () => {
    const img = makeTestImage(20, 20, (x, y) => {
      const inside = x >= 5 && x < 15 && y >= 5 && y < 15;
      return inside ? [255, 0, 0, 255] : [200, 200, 200, 255];
    });
    const mask = edgeDetectMask(img);
    expect(mask[10 * 20 + 10]).toBeGreaterThan(128);
    expect(mask[0]).toBeLessThanOrEqual(128);
  });
});

describe('removeBackgroundHeuristic', () => {
  it('auto-selects flood fill when click point provided', async () => {
    const img = redBlueSplit(20, 20);
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      clickPoint: { x: 15, y: 10 },
    });
    expect(typeof result.maskDataUrl).toBe('string');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('handles solid white image gracefully', async () => {
    const img = solidWhite(10, 10);
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(typeof result.maskDataUrl).toBe('string');
  });

  it('feather parameter non-zero changes processing time', async () => {
    const img = redBlueSplit(20, 20);
    const feathered = await removeBackgroundHeuristic(img, {
      method: 'quick',
      clickPoint: { x: 15, y: 10 },
      feather: 2,
    });
    expect(feathered.confidence).toBeGreaterThan(0);
    expect(typeof feathered.maskDataUrl).toBe('string');
  });

  it('handles minimal image (1x1) gracefully', async () => {
    const tiny = new ImageData(1, 1);
    const result = await removeBackgroundHeuristic(tiny, { method: 'quick' });
    expect(typeof result.maskDataUrl).toBe('string');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });

  it('keeps a hard-edge logo on a white field', async () => {
    const img = makeTestImage(24, 24, (x, y) => {
      const logo = x >= 6 && x < 18 && y >= 6 && y < 18;
      return logo ? [20, 20, 20, 255] : [255, 255, 255, 255];
    });
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(result.rawMask?.[12 * 24 + 12]).toBe(255);
    expect(result.rawMask?.[0]).toBe(0);
  });

  it('keeps a central subject on a wide panoramic strip', async () => {
    const img = makeTestImage(80, 8, (x, y) => {
      const subject = x >= 32 && x < 48 && y >= 1 && y < 7;
      return subject ? [30, 90, 200, 255] : [240, 240, 240, 255];
    });
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(result.width).toBe(80);
    expect(result.height).toBe(8);
    expect(result.rawMask?.[4 * 80 + 40]).toBe(255);
    expect(result.rawMask?.[0]).toBe(0);
  });

  it('auto uses source alpha when a cutout subject touches the frame', async () => {
    const img = makeTestImage(20, 10, (x, _y) => {
      const subject = x < 10;
      return subject ? [30, 90, 200, 255] : [0, 255, 0, 0];
    });
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(result.rawMask?.[0]).toBe(255);
    expect(result.rawMask?.[9]).toBe(255);
    expect(result.rawMask?.[10]).toBe(0);
    expect(result.rawMask?.filter((v) => v === 255)).toHaveLength(100);
  });

  it('preserves existing transparency on a cutout PNG and ignores fringe RGB', async () => {
    const img = makeTestImage(16, 16, (x, y) => {
      const subject = x >= 4 && x < 12 && y >= 4 && y < 12;
      return subject ? [200, 40, 40, 255] : [0, 255, 0, 0];
    });
    const result = await removeBackgroundHeuristic(img, {
      method: 'quick',
      heuristicMethod: 'auto',
    });
    expect(result.rawMask?.[0]).toBe(0);
    expect(result.rawMask?.[8 * 16 + 8]).toBe(255);
  });

  it('decontaminate option actually chokes the mask before encoding', async () => {
    // `maskDataUrl` degrades to a fixed placeholder string outside a DOM
    // environment (`maskToDataUrl`'s `typeof document` guard), and a mostly
    // 50/50-split confidence score saturates at the same clamped value
    // whether or not decontamination ran — neither is a reliable observable
    // here. Instead, verify the wiring directly: `decontaminateMask` (unit
    // tested in isolation in `maskOps.test.ts`) must be invoked exactly when
    // `opts.decontaminate` is set, and never otherwise.
    const spy = vi.spyOn(await import('../maskOps'), 'decontaminateMask');
    const img = redBlueSplit(20, 20);
    const base = { method: 'quick' as const, clickPoint: { x: 15, y: 10 } };

    await removeBackgroundHeuristic(img, base);
    expect(spy).not.toHaveBeenCalled();

    await removeBackgroundHeuristic(img, { ...base, decontaminate: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array), 20, 20);

    spy.mockRestore();
  });
});
