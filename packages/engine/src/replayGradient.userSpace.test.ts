import { describe, expect, it, vi } from 'vitest';
import { createGradientStyle, resetGradientCacheForTest } from './replayGradient';
import type { ReplayTarget } from './replayTypes';
import type { FillIR, RenderItem } from './types';

const BOUNDS = { x: 0, y: 0, w: 100, h: 80 };
const ITEM: RenderItem = {
  transform: [1, 0, 0, 1, 620, 371],
  primitive: { kind: 'rect', ...BOUNDS },
  fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
};

function gradient(
  gradientType: 'linear' | 'radial' | 'angular' | 'diamond',
): Extract<FillIR, { type: 'gradient' }> {
  return {
    type: 'gradient',
    gradientType,
    transform: [100, 0, 0, 80, 0, 0],
    rotation: 0,
    stops: [
      { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
      { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
    ],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function nativeLikeTarget() {
  const ctm = { a: 2, b: 0.5, c: -0.25, d: 3, e: 620, f: 371 };
  const result = { addColorStop: vi.fn() };
  const linear = vi.fn(() => result);
  const radial = vi.fn(() => result);
  const conic = vi.fn(() => result);
  const target = {
    getTransform: () => ctm,
    createLinearGradient: linear,
    createRadialGradient: radial,
    createConicGradient: conic,
  } as unknown as ReplayTarget;
  return { target, ctm, linear, radial, conic };
}

describe('Canvas gradient construction uses current user coordinates', () => {
  it('does not apply the active item/camera CTM to linear endpoints a second time', () => {
    const { target, linear } = nativeLikeTarget();
    createGradientStyle(target, gradient('linear'), ITEM, BOUNDS);
    expect(linear).toHaveBeenCalledWith(0, 40, 100, 40);
  });

  it.each(['radial', 'diamond'] as const)(
    'leaves %s centre and radius in the native constructor user space',
    (type) => {
      const { target, radial } = nativeLikeTarget();
      createGradientStyle(
        target,
        { ...gradient(type), transform: [174, 0, 0, 174, -87, -87] },
        ITEM,
        BOUNDS,
      );
      expect(radial).toHaveBeenCalledWith(0, 0, 0, 0, 0, 87);
    },
  );

  it('leaves the conic centre and orientation local under a nonidentity CTM', () => {
    const { target, conic } = nativeLikeTarget();
    createGradientStyle(
      target,
      { ...gradient('angular'), transform: [0, 80, -100, 0, 100, 0] },
      ITEM,
      BOUNDS,
    );
    expect(conic).toHaveBeenCalledWith(Math.PI / 2, 50, 40);
  });

  it('still invalidates the gradient cache when the context transform changes', () => {
    resetGradientCacheForTest();
    const { target, ctm, linear } = nativeLikeTarget();
    const fill = gradient('linear');
    createGradientStyle(target, fill, ITEM, BOUNDS);
    ctm.e += 25;
    createGradientStyle(target, fill, ITEM, BOUNDS);
    expect(linear).toHaveBeenCalledTimes(2);
    expect(linear.mock.calls).toEqual([
      [0, 40, 100, 40],
      [0, 40, 100, 40],
    ]);
  });
});
