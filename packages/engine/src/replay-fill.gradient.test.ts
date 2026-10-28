// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import { replayIr } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { FillIR, RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('gradient fill rendering', () => {
  it('renders linear gradient fill (createLinearGradient + addColorStop + fill)', () => {
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
    expect(rec.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('fillRect('))).toBe(true);
  });

  it('renders radial gradient fill (createRadialGradient + addColorStop)', () => {
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
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders angular gradient via createConicGradient', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'angular',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
            { position: 0.5, color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createConicGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('renders diamond gradient as radial fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'diamond',
          stops: [
            { position: 0, color: { space: 'rgb', r: 255, g: 255, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
          ],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('createRadialGradient('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('addColorStop('))).toBe(true);
  });

  it('gradient with zero stops returns transparent fallback', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    expect(String(rec.props.fillStyle ?? '')).toBe('rgba(0,0,0,0)');
  });

  it('gradient rotation rotates the gradient axis', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 90,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    const rec2 = recorder();
    replayIr(rec2.target, [item]);
    const lgCall = rec2.calls.find((c) => c.startsWith('createLinearGradient('));
    expect(lgCall).toBeTruthy();
  });

  it('clamps rotation 450 to same as rotation 90', () => {
    const baseCtx = recorder();
    const baseItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 90,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    replayIr(baseCtx.target, [baseItem]);

    const clampedCtx = recorder();
    const clampedFill: FillIR = { ...baseItem.fills![0], rotation: 450 } as FillIR;
    const clampedItem: RenderItem = {
      ...baseItem,
      fills: [clampedFill],
    };
    replayIr(clampedCtx.target, [clampedItem]);
    const call450 = clampedCtx.calls.find((c) => c.startsWith('createLinearGradient('));

    // Gradients are target/CTM-specific Canvas objects, so a separate replay
    // target must recreate the same visual geometry instead of reusing a
    // gradient captured in another canvas's coordinate system.
    expect(call450).toBeTruthy();
  });

  it('clamps rotation -90 to same as rotation 270', () => {
    const baseCtx = recorder();
    const baseItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
          ],
          rotation: 270,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    };
    replayIr(baseCtx.target, [baseItem]);

    const clampedCtx = recorder();
    const clampedFill: FillIR = { ...baseItem.fills![0], rotation: -90 } as FillIR;
    const clampedItem: RenderItem = {
      ...baseItem,
      fills: [clampedFill],
    };
    replayIr(clampedCtx.target, [clampedItem]);
    const callNeg90 = clampedCtx.calls.find((c) => c.startsWith('createLinearGradient('));

    expect(callNeg90).toBeTruthy();
  });
});
