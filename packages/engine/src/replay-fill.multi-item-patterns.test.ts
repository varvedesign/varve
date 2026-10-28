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
  it('routes half-drop fills through the shared repeat lattice', () => {
    getImageCache().setLoaded('half-drop-tile.png', mockImage('half-drop-tile.png', 8, 8));
    const rec = recorder();
    const patternTransforms: DOMMatrix2DInit[] = [];
    rec.target.createPattern = () =>
      ({
        setTransform(transform: DOMMatrix2DInit) {
          patternTransforms.push(transform);
        },
      }) as unknown as CanvasPattern;

    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'half-drop-tile.png',
            spacing: 0,
            gapX: 0,
            gapY: 0,
            imageWidth: 8,
            imageHeight: 8,
            arrangement: 'half-drop',
            columnShift: 0.5,
            rotation: 0,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 30, y: 40, w: 40, h: 32 },
      },
    ]);

    expect(patternTransforms).toHaveLength(1);
    expect(patternTransforms[0]?.a).toBeCloseTo(1);
    expect(patternTransforms[0]?.b).toBeCloseTo(0.5);
    expect(patternTransforms[0]?.c).toBeCloseTo(0);
    expect(patternTransforms[0]?.d).toBeCloseTo(1);
  });

  it('image fill renders placeholder when drawImage unavailable', () => {
    const rec = recorder();
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
    // placeholder fillRect should be called
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('pattern fill renders as tinted placeholder', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'pattern',
          tileSrc: 'tile.png',
          spacing: 4,
          rotation: 0,
          opacity: 0.8,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Pattern fill: set fillStyle + paintShapeFill (fillRect for rect)
    expect(rec.calls.some((c) => c.startsWith('set fillStyle'))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('honours pattern imageWidth/imageHeight dimension overrides', () => {
    getImageCache().setLoaded('tile-dim.png', mockImage('tile-dim.png', 200, 200));
    const drawCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
    const rec = recorder();
    rec.target.drawImage = (_img: unknown, x: number, y: number, w: number, h: number) => {
      drawCalls.push({ x, y, w, h });
    };
    replayIr(rec.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: [
          {
            type: 'pattern',
            tileSrc: 'tile-dim.png',
            spacing: 0,
            rotation: 0,
            imageWidth: 32,
            imageHeight: 24,
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
        primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      },
    ]);
    expect(drawCalls.length).toBeGreaterThan(0);
    for (const dc of drawCalls) {
      expect(dc.w).toBe(32);
      expect(dc.h).toBe(24);
    }
  });

  it('starts loading a visible pattern tile when it is not cached', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'pattern',
          tileSrc: 'missing-tile.png',
          spacing: 4,
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };

    replayIr(rec.target, [item]);

    expect(getImageCache().state('missing-tile.png')).toBe('loading');
  });

  it('image fill with empty src is transparent (no placeholder)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      fills: [
        {
          type: 'image',
          src: '',
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
    // An empty image fill contributes nothing: no clip, no placeholder fillRect,
    // and no paint at all (fills[] is authoritative over the legacy item.fill).
    expect(rec.calls).not.toContain('clip(0)');
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(false);
    expect(rec.calls.filter((c) => c === 'fill(0)').length).toBe(0);
    expect(rec.props.fillStyle).toBeUndefined();
  });

  it('image fill ignored when visible is false', () => {
    const rec = recorder();
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
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    // Invisible fill: no fills are drawn, no fillStyle set
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(0);
  });
});
