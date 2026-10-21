// @vitest-environment jsdom

import { getImageCache } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectImageFillSrcs, countPatternFillsWithoutTileSource } from './printImageManifest';

const { loadImage } = vi.hoisted(() => ({ loadImage: vi.fn() }));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    getImageCache: vi.fn(() => ({ load: loadImage })),
  };
});

afterEach(() => {
  vi.mocked(getImageCache).mockClear();
  loadImage.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('print image resource source collection', () => {
  it('includes visible image and pattern tiles, deduplicating later during manifest assembly', () => {
    const sources = collectImageFillSrcs([
      {
        fills: [
          { type: 'image', image: { src: 'data:image/png;base64,image' } },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,pattern' } },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,pattern' } },
          { type: 'pattern', visible: false, pattern: { tileSrc: 'hidden.png' } },
        ],
      },
    ]);

    expect(sources).toEqual([
      'data:image/png;base64,image',
      'data:image/png;base64,pattern',
      'data:image/png;base64,pattern',
    ]);
  });
});

describe('missing pattern resource detection', () => {
  it('counts only visible pattern fills with an empty tile source', () => {
    const count = countPatternFillsWithoutTileSource([
      {
        fills: [
          { type: 'pattern', pattern: { tileSrc: '' } },
          { type: 'pattern', tileSrc: '  ' },
          { type: 'pattern', visible: false, pattern: { tileSrc: '' } },
          { type: 'image', tileSrc: '' },
          { type: 'pattern', pattern: { tileSrc: 'data:image/png;base64,abc' } },
        ],
      },
    ]);

    expect(count).toBe(2);
  });
});

describe('print image manifest memory budget', () => {
  it('rejects an oversized decoded image before allocating an export canvas', async () => {
    loadImage.mockResolvedValue({ width: 8000, height: 8000 } as ImageBitmap);
    const createElement = vi.spyOn(document, 'createElement');
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4) }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as never);

    const { buildPrintImageManifestForSrcs } = await import('./printImageManifest');
    await expect(buildPrintImageManifestForSrcs(['large-photo.png'])).rejects.toThrow(
      /exceeds the 192 MB print limit\. Downsample large images or remove some images/,
    );

    expect(createElement).not.toHaveBeenCalledWith('canvas');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('checks the aggregate source budget before allocating the next export canvas', async () => {
    loadImage
      .mockResolvedValueOnce({ width: 6000, height: 8000 } as ImageBitmap)
      .mockResolvedValueOnce({ width: 6000, height: 8000 } as ImageBitmap);
    const createElement = vi.spyOn(document, 'createElement');
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4) }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData,
    } as never);

    const { buildPrintImageManifestForSrcs } = await import('./printImageManifest');
    await expect(
      buildPrintImageManifestForSrcs(['first-photo.png', 'second-photo.png']),
    ).rejects.toThrow(/exceeds the 192 MB print limit/);

    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(createElement).toHaveBeenCalledTimes(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized raster-fallback bitmap before creating its readback canvas', async () => {
    const closeBitmap = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 8000, height: 8000, close: closeBitmap }),
    );
    const createElement = vi.spyOn(document, 'createElement');

    const { buildPrintImageManifestFromPngBlob } = await import('./printImageManifest');
    await expect(
      buildPrintImageManifestFromPngBlob(new Blob(), 'raster-fallback.png'),
    ).rejects.toThrow(/exceeds the 192 MB print limit/);

    expect(createElement).not.toHaveBeenCalledWith('canvas');
    expect(closeBitmap).toHaveBeenCalledOnce();
  });
});
