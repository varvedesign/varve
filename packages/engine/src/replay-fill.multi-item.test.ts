// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import { replayIr } from './replay';
import { mockImage, recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('multi-item compositing edge cases', () => {
  it('multiple fills stack bottom→top with correct paint order', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(2);
    const lastFillStyle = String(rec.props.fillStyle ?? '');
    expect(lastFillStyle).toContain('0, 255, 0');
  });

  it('arrow does not double-draw arrowhead in fill+stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 2,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
    };
    replayIr(rec.target, [item]);
    const fillCalls = rec.calls.filter((c) => c === 'fill(0)');
    expect(fillCalls.length).toBe(1);
  });

  it('rgba() alpha precision uses raw division, not toFixed(3)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 1 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 5, h: 6 },
    };
    replayIr(rec.target, [item]);
    const fs = String(rec.props.fillStyle ?? '');
    expect(fs).not.toBe('rgba(57, 208, 198, 0.004)');
    expect(fs).toBe('rgba(57, 208, 198, 0.00392156862745098)');
  });

  it('skips clipping for an exact-fit image fill while drawing via drawImage', () => {
    // Pre-load the image so paintImageFill takes the cached path.
    getImageCache().setLoaded('test.png', mockImage('test.png', 50, 50));
    const rec = recorder();
    const target = rec.target as unknown as Record<string, unknown>;
    let drawImageCalled = false;
    target.drawImage = (_src: unknown, _dx: unknown, _dy: unknown, _dw: unknown, _dh: unknown) => {
      drawImageCalled = true;
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'test.png',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(drawImageCalled).toBe(true);
    // Exact-fit square images do not need a redundant rectangle clip.
    expect(rec.calls).not.toContain('clip(0)');
    expect(rec.calls.some((c) => c.startsWith('restore'))).toBe(true);
  });

  it('clips image fills to non-rectangular primitive outlines', () => {
    getImageCache().setLoaded('ellipse.png', mockImage('ellipse.png', 80, 40));
    const rec = recorder();
    const calls: string[] = [];
    rec.target.drawImage = () => calls.push('drawImage');
    rec.target.clip = () => calls.push('clip');
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'ellipse.png',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'ellipse', cx: 50, cy: 30, rx: 40, ry: 20 },
      },
    ]);
    expect(calls).toEqual(['clip', 'drawImage']);
    expect(rec.calls).toContain('ellipse(7)');
  });

  it('offsets pattern tiles to the primitive bounds before clipping', () => {
    getImageCache().setLoaded('tile-offset.png', mockImage('tile-offset.png', 8, 8));
    const rec = recorder();
    const positions: Array<[number, number]> = [];
    rec.target.drawImage = (_image, x, y) => positions.push([x, y]);
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'tile-offset.png',
            spacing: 2,
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 30, y: 40, w: 20, h: 20 },
      },
    ]);
    expect(positions[0]).toEqual([30, 40]);
  });

  it('an image fill with a loading src still paints the loading placeholder', () => {
    const rec = recorder();
    let drawImageCalled = false;
    rec.target.drawImage = () => {
      drawImageCalled = true;
    };
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'image',
            src: 'https://example.invalid/not-loaded.png',
            fit: 'fill',
            x: 0,
            y: 0,
            scale: 1,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ]);
    // The exact-fit placeholder covers the rect directly, just like its loaded image.
    expect(rec.calls).not.toContain('clip(0)');
    // Placeholder path paints: fillStyle assigned (loading grey) + fillRect.
    expect(rec.calls.filter((c) => c === 'set fillStyle').length).toBeGreaterThanOrEqual(2);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
    expect(drawImageCalled).toBe(false);
  });

  it('a pattern fill with an empty tileSrc renders transparent (no grey rectangle)', () => {
    const rec = recorder();
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: '',
            spacing: 0,
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      },
    ]);
    expect(rec.calls).not.toContain('clip(0)');
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(false);
    expect(rec.calls.filter((c) => c === 'fill(0)').length).toBe(0);
    expect(rec.props.fillStyle).toBeUndefined();
  });

  it.each([
    { name: 'zero repeat increment', width: 8, height: 8, spacing: -8 },
    { name: 'zero natural dimensions', width: 0, height: 0, spacing: 0 },
  ])('falls back safely for $name', ({ width, height, spacing }) => {
    getImageCache().setLoaded('invalid-tile.png', mockImage('invalid-tile.png', width, height));
    const rec = recorder();
    let drawCount = 0;
    rec.target.drawImage = () => {
      drawCount++;
      if (drawCount > 5) throw new Error('pattern loop did not advance');
    };

    expect(() =>
      replayIr(rec.target, [
        {
          transform: [1, 0, 0, 1, 0, 0],
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [
            {
              type: 'pattern',
              tileSrc: 'invalid-tile.png',
              spacing,
              rotation: 0,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          primitive: { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        },
      ]),
    ).not.toThrow();
    expect(drawCount).toBe(0);
    expect(rec.calls).toContain('fillRect(4)');
  });

  it('rotates a zero-spacing pattern around the primitive center when supported', () => {
    getImageCache().setLoaded('rotated-tile.png', mockImage('rotated-tile.png', 8, 8));
    const rec = recorder();
    const patternTransforms: Array<{
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    }> = [];
    rec.target.createPattern = () =>
      ({
        setTransform(transform: DOMMatrix2DInit) {
          patternTransforms.push({
            a: transform.a ?? 1,
            b: transform.b ?? 0,
            c: transform.c ?? 0,
            d: transform.d ?? 1,
            e: transform.e ?? 0,
            f: transform.f ?? 0,
          });
        },
      }) as unknown as CanvasPattern;

    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'rotated-tile.png',
            spacing: 0,
            rotation: 90,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 30, y: 40, w: 20, h: 10 },
      },
    ]);

    expect(patternTransforms).toHaveLength(1);
    const patternTransform = patternTransforms[0];
    expect(patternTransform?.a).toBeCloseTo(0);
    expect(patternTransform?.b).toBeCloseTo(1);
    expect(patternTransform?.c).toBeCloseTo(-1);
    expect(patternTransform?.d).toBeCloseTo(0);
    expect(patternTransform?.e).toBeCloseTo(45);
    expect(patternTransform?.f).toBeCloseTo(35);
  });
});
