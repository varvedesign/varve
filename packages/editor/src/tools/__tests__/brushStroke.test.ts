/**
 * Robustness and pressure-policy contracts for the coverage-painting helpers
 * shared by refine-mask, trimap and selection-paint.
 *
 * These are the module's public edges: a coordinate that is not a number and a
 * segment that is absurdly long both arrive from real callers (a singular
 * world→source mapping, a pointer jump across a large mask), and a pressure
 * report arrives from every device in the field.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_SETTINGS, loadSettings, saveSettings } from '../../settings';
import {
  effectivePressure,
  interpolateStrokeSegment,
  MAX_INTERPOLATED_SEGMENT_POINTS,
  NOMINAL_COVERAGE_PRESSURE,
} from '../brushStroke';
import { refreshDrawingInputSettings, resetDrawingInputRuntime } from '../drawingInputRuntime';
import { observeInputCapabilities, resetObservedInputCapabilities } from '../inputNormalizer';

/** Persist a drawing-input setting the way the Settings dialog does. */
function setPressureEnabled(enabled: boolean): void {
  const settings = loadSettings();
  saveSettings({
    ...DEFAULT_EDITOR_SETTINGS,
    ...settings,
    drawingInput: { ...settings.drawingInput, pressureEnabled: enabled },
  });
  refreshDrawingInputSettings();
}

afterEach(() => {
  localStorage.clear();
  resetDrawingInputRuntime();
  refreshDrawingInputSettings();
  resetObservedInputCapabilities();
});

describe('interpolateStrokeSegment', () => {
  it('covers the segment end exactly once', () => {
    const points = interpolateStrokeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(points[points.length - 1]).toEqual({ x: 10, y: 0 });
    expect(points).toHaveLength(3);
  });

  it('returns the destination for a degenerate segment', () => {
    expect(interpolateStrokeSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, 1)).toEqual([{ x: 5, y: 5 }]);
  });

  it('drops a non-finite destination instead of forwarding it as a point', () => {
    expect(interpolateStrokeSegment({ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, 1)).toEqual([]);
    expect(
      interpolateStrokeSegment({ x: 0, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }, 1),
    ).toEqual([]);
  });

  it('keeps a valid destination when only the origin is unusable', () => {
    expect(interpolateStrokeSegment({ x: Number.NaN, y: 0 }, { x: 12, y: 0 }, 1)).toEqual([
      { x: 12, y: 0 },
    ]);
  });

  it('never emits a non-finite point for finite input', () => {
    const points = interpolateStrokeSegment({ x: 0, y: 0 }, { x: 1e6, y: -1e6 }, 0.01);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('bounds the allocation for an absurd distance without leaving a gap', () => {
    const points = interpolateStrokeSegment({ x: 0, y: 0 }, { x: 1e9, y: 0 }, 0.001);
    expect(points.length).toBeLessThanOrEqual(MAX_INTERPOLATED_SEGMENT_POINTS);
    // The widened step still covers the whole segment.
    expect(points[points.length - 1]).toEqual({ x: 1e9, y: 0 });
  });

  it('treats a malformed spacing as a single step rather than dividing by zero', () => {
    const points = interpolateStrokeSegment({ x: 0, y: 0 }, { x: 8, y: 0 }, 0);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(MAX_INTERPOLATED_SEGMENT_POINTS);
    expect(points[points.length - 1]).toEqual({ x: 8, y: 0 });
  });
});

describe('effectivePressure', () => {
  it('deposits nominally when pressure is disabled', () => {
    setPressureEnabled(false);
    expect(effectivePressure({ pressure: 0.02, pointerType: 'pen' })).toBe(
      NOMINAL_COVERAGE_PRESSURE,
    );
  });

  it('keeps a legitimately light pen sample light instead of inflating it', () => {
    // The previous fixed 0.05 floor inflated this 2.5x.
    expect(effectivePressure({ pressure: 0.02, pointerType: 'pen' })).toBe(0.02);
  });

  it('lets a mouse deposit the same amount whatever the browser reports', () => {
    const withZero = effectivePressure({ pressure: 0, pointerType: 'mouse' });
    const withHalf = effectivePressure({ pressure: 0.5, pointerType: 'mouse' });
    expect(withZero).toBe(NOMINAL_COVERAGE_PRESSURE);
    expect(withHalf).toBe(NOMINAL_COVERAGE_PRESSURE);
  });

  it('paints nominally for a pen that has never reported pressure variation', () => {
    // No observed pressure capability: a zero sample must not drop the stroke.
    expect(effectivePressure({ pressure: 0, pointerType: 'pen' })).toBe(NOMINAL_COVERAGE_PRESSURE);
  });

  it('treats zero as a real zero once the device has demonstrated pressure sensing', () => {
    // Two distinct readings is what the normalizer records as 'observed'.
    const observe = (pressureValue: number): void => {
      const ev = {
        pointerType: 'pen',
        pressure: pressureValue,
        buttons: 1,
        button: 0,
        tiltX: 0,
        tiltY: 0,
        twist: -1,
      } as unknown as PointerEvent;
      observeInputCapabilities(ev);
    };
    observe(0.2);
    observe(0.7);

    expect(effectivePressure({ pressure: 0, pointerType: 'pen' })).toBe(0);
    expect(effectivePressure({ pressure: 0.4, pointerType: 'pen' })).toBe(0.4);
  });
});
