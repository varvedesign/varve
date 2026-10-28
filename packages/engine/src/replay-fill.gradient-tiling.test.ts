// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import { replayIr } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('gradient fill rendering', () => {
  it('invisible gradient fill is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(false);
  });

  it('gradient tilingMode=repeat uses createPattern with repeat', () => {
    // Provide a working OffscreenCanvas for this test
    const OrigOC = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class MockOC {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillStyle: '',
          fillRect: () => {},
          drawImage: () => {},
          save: () => {},
          restore: () => {},
          scale: () => {},
          translate: () => {},
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    } as unknown as typeof OffscreenCanvas;

    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          tilingMode: 'repeat',
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern(repeat)'))).toBe(true);
    globalThis.OffscreenCanvas = OrigOC;
  });

  it('gradient tilingMode=reflect uses createPattern with repeat', () => {
    const OrigOC = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class MockOC {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillStyle: '',
          fillRect: () => {},
          drawImage: () => {},
          save: () => {},
          restore: () => {},
          scale: () => {},
          translate: () => {},
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
      convertToBlob() {
        return Promise.resolve(new Blob());
      }
    } as unknown as typeof OffscreenCanvas;

    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          tilingMode: 'reflect',
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern(repeat)'))).toBe(true);
    globalThis.OffscreenCanvas = OrigOC;
  });

  it('tiled gradients apply the complete affine field to the pattern', () => {
    const OrigOC = globalThis.OffscreenCanvas;
    globalThis.OffscreenCanvas = class MockOC {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillStyle: '',
          fillRect: () => {},
          drawImage: () => {},
          save: () => {},
          restore: () => {},
          scale: () => {},
          translate: () => {},
        } as unknown as OffscreenCanvasRenderingContext2D;
      }
    } as unknown as typeof OffscreenCanvas;

    const rec = recorder();
    let applied: { a: number; b: number; c: number; d: number; e: number; f: number } | undefined;
    rec.target.createPattern = () =>
      ({
        setTransform(transform: typeof applied) {
          applied = transform;
        },
      }) as unknown as CanvasPattern;
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          transform: [120, 30, -10, 60, 12, 8],
          tilingMode: 'repeat',
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };

    replayIr(rec.target, [item]);
    expect(applied).toEqual({
      a: 120 / 256,
      b: 30 / 256,
      c: -10 / 256,
      d: 60 / 256,
      e: 12,
      f: 8,
    });
    globalThis.OffscreenCanvas = OrigOC;
  });

  it('gradient with tilingMode undefined uses standard gradient (no createPattern)', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createPattern'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
  });

  it('materializes an explicit linear gradient in local coordinates', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          transform: [160, 80, -30, 45, 25, 15],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).not.toContain('transform(160,80,-30,45,25,15)');
    expect(rec.calls).toContain('createLinearGradient(10,37.5,170,117.5)');
  });

  it('materializes radial geometry in local coordinates', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'radial',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
          ],
          rotation: 0,
          transform: [173.2, 100, -12.5, 21.65, 40, 30],
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).not.toContain('transform(173.2,100,-12.5,21.65,40,30)');
    expect(
      rec.calls.some((call) =>
        call.startsWith('createRadialGradient(120.35,90.825,0,120.35,90.825,'),
      ),
    ).toBe(true);
  });
});
