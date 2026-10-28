/** replayIr: canvas state restore, opacity, blend modes, shadows, and empty IR. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { Recorder, recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('restores canvas state when painting an item throws', () => {
    const rec = recorder();
    let restoreCount = 0;
    rec.target.restore = () => {
      restoreCount++;
    };
    rec.target.fillRect = () => {
      throw new Error('paint failed');
    };
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };

    expect(() => replayIr(rec.target, [item])).toThrow('paint failed');
    expect(restoreCount).toBe(1);
  });

  it('applies item opacity via globalAlpha', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      opacity: 0.5,
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // opacity=0.5 → set globalAlpha=0.5 during paint, then reset to 1.
    // The calls array contains at least one 'set globalAlpha'.
    const alphaCalls = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaCalls.length).toBeGreaterThanOrEqual(1);
    // The recorded value after paint+reset should be 1.
    expect(rec.props.globalAlpha).toBe(1);
  });

  it('applies blend mode via globalCompositeOperation', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      blendMode: 'multiply',
      primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    const blendCalls = rec.calls.filter((c) => c === 'set globalCompositeOperation');
    expect(blendCalls.length).toBeGreaterThanOrEqual(1);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
  });

  it('resets alpha/blend/shadow after each item', () => {
    const items: RenderItem[] = [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        opacity: 0.5,
        blendMode: 'screen',
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      },
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      },
    ];
    const rec = recorder();
    replayIr(rec.target, items);
    expect(rec.props.globalAlpha).toBe(1);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
    // Two items → two paint cycles → shadow/filter/alpha/blend resets twice each.
    const alphaSets = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaSets.length).toBeGreaterThanOrEqual(2);
  });

  it('handles an empty IR', () => {
    const rec = recorder();
    replayIr(rec.target, []);
    expect(rec.calls).toEqual([]);
  });

  it('innerShadow on a rect primitive does not throw when the offscreen effect buffer is unavailable', () => {
    // innerShadow renders its silhouette via paintInsetEffect, which traces
    // the outline (rect() for an unrounded rect, since fillRect() is used as
    // a fast path for the base fill instead of rect()/fill()) onto a
    // *separate offscreen canvas* created by createEffectBuffer — never onto
    // `target` directly. In this test environment neither OffscreenCanvas
    // (stubbed to return a null context, see vitest.setup.ts) nor `document`
    // is available, so createEffectBuffer always returns null and
    // paintInsetEffect bails out before tracing anything. That means a
    // `rec.calls` assertion on rect()/ellipse() can never observe this
    // codepath — the achievable, meaningful assertion here (matching the
    // established convention in replay-fill.test.ts's "backgroundBlur
    // gracefully handles unavailable OffscreenCanvas") is that this
    // unavailability is handled gracefully rather than throwing.
    const rec = new Recorder();
    const effects: RenderItem['effects'] = [
      {
        type: 'innerShadow',
        x: 2,
        y: 2,
        blur: 4,
        spread: 0,
        color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
        opacity: 0.5,
        blendMode: 'normal' as const,
        visible: true,
      },
    ];
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0] as const,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } as const,
      effects,
      primitive: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 100 },
    };
    expect(() => replayIr(rec, [item])).not.toThrow();
  });
});
