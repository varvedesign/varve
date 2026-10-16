import type { Affine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { applyWorkerCamera, reprojectableWorkerDelta, workerBitmapDelta } from './workerCamera';

describe('applyWorkerCamera', () => {
  it('applies DPR, pan, viewport-centred rotation, and zoom in main-thread order', () => {
    const calls: string[] = [];
    const target = {
      setTransform: vi.fn((a, b, c, d, e, f) => calls.push(`matrix:${a},${b},${c},${d},${e},${f}`)),
      translate: vi.fn((x, y) => calls.push(`translate:${x},${y}`)),
      rotate: vi.fn((radians) => calls.push(`rotate:${radians}`)),
      scale: vi.fn((x, y) => calls.push(`scale:${x},${y}`)),
    };

    applyWorkerCamera(target, { pan: { x: 12, y: -8 }, zoom: 1.5, rotation: Math.PI / 4 }, 2, {
      width: 800,
      height: 600,
    });

    expect(calls).toEqual([
      'matrix:2,0,0,2,0,0',
      'translate:12,-8',
      'translate:400,300',
      `rotate:${Math.PI / 4}`,
      'translate:-400,-300',
      'scale:1.5,1.5',
    ]);
  });
});

describe('workerBitmapDelta', () => {
  it('maps pan and zoom changes in physical pixels', () => {
    const delta = workerBitmapDelta(
      { pan: { x: 10, y: 20 }, zoom: 1, rotation: 0 },
      { pan: { x: 30, y: 10 }, zoom: 2, rotation: 0 },
      { width: 800, height: 600 },
      2,
    );
    expect(delta).not.toBeNull();
    expect(delta?.[0]).toBeCloseTo(2);
    expect(delta?.[3]).toBeCloseTo(2);
    expect(delta?.[4]).toBeCloseTo(20);
    expect(delta?.[5]).toBeCloseTo(-60);
  });

  it('maps camera rotation instead of displaying a stale unrotated frame', () => {
    const delta = workerBitmapDelta(
      { pan: { x: 0, y: 0 }, zoom: 1, rotation: 0 },
      { pan: { x: 0, y: 0 }, zoom: 1, rotation: Math.PI / 2 },
      { width: 800, height: 600 },
      1,
    );
    expect(delta?.[1]).toBeCloseTo(1);
    expect(delta?.[2]).toBeCloseTo(-1);
  });
});

describe('reprojectableWorkerDelta', () => {
  const identity: Affine = [1, 0, 0, 1, 0, 0];

  it('refuses to reproject when the document changed, even with the identity delta', () => {
    // The defect this pins: `workerBitmapDelta` returns an affine whenever the
    // two camera transforms differ, *including the identity* when they do not, so
    // a truthiness test on the delta alone accepted the unchanged-camera case.
    // A brush stroke changes the document and leaves the camera alone, so the
    // pre-edit bitmap was composited and the fresh replay skipped — the new ink
    // stayed invisible until something forced a full redraw. Reproduced as one
    // silent stroke in five, with a forced redraw recovering the pixels.
    expect(reprojectableWorkerDelta(false, identity)).toBeNull();
    expect(reprojectableWorkerDelta(false, [2, 0, 0, 2, 10, 10])).toBeNull();
  });

  it('allows reprojection for a camera-only change', () => {
    expect(reprojectableWorkerDelta(true, [2, 0, 0, 2, 10, 10])).toEqual([2, 0, 0, 2, 10, 10]);
    expect(reprojectableWorkerDelta(true, identity)).toEqual(identity);
  });

  it('refuses when there is no delta at all', () => {
    expect(reprojectableWorkerDelta(true, null)).toBeNull();
  });
});
