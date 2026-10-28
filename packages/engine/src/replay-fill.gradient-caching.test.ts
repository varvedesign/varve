// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import { replayIr, resetGradientCacheForTest } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('gradient degenerate shape handling', () => {
  it('shape with w=0,h=0 renders as solid fill of last stop (no gradient API calls)', () => {
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
            { position: 1, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient'))).toBe(false);
    expect(rec.calls.some((c) => c.startsWith('createConicGradient'))).toBe(false);
    expect(String(rec.props.fillStyle ?? '')).toContain('0, 255, 0');
  });

  it('transform matrix with zero scale produces solid fill (no gradient API calls)', () => {
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
          transform: [0, 0, 0, 0, 50, 50],
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient'))).toBe(false);
    expect(String(rec.props.fillStyle ?? '')).toContain('0, 0, 255');
  });
});

describe('gradient caching', () => {
  it('identical gradient fills reuse cached gradient (only one gradient created)', () => {
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
    const lgCalls = rec.calls.filter((c) => c.startsWith('createLinearGradient('));
    expect(lgCalls.length).toBe(1);
  });

  it('does not quantize bounds when caching legacy gradient geometry', () => {
    resetGradientCacheForTest();
    const rec = recorder();
    const base: RenderItem = {
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
          rotation: 17,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    };
    replayIr(rec.target, [base]);
    replayIr(rec.target, [{ ...base, primitive: { kind: 'rect', x: 0.004, y: 0, w: 100, h: 50 } }]);
    expect(rec.calls.filter((call) => call.startsWith('createLinearGradient')).length).toBe(2);
  });
});
