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
describe('per-fill compositing', () => {
  it('per-fill opacity multiplies with item alpha', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      opacity: 0.5,
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const alphaSets = rec.calls.filter((c) => c === 'set globalAlpha');
    expect(alphaSets.length).toBeGreaterThanOrEqual(1);
    expect(Number(rec.props.globalAlpha)).toBe(1);
  });

  it('per-fill blend mode is isolated from the next fill', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'multiply',
          visible: true,
        },
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    };
    replayIr(rec.target, [item]);
    expect(rec.props.globalCompositeOperation).toBe('source-over');
    const compCalls = rec.calls.filter((c) => c === 'set globalCompositeOperation');
    expect(compCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('per-fill visible=false fill is skipped in stack', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    replayIr(rec.target, [item]);
    const fillStyleSets = rec.calls.filter((c) => c === 'set fillStyle');
    expect(fillStyleSets.length).toBe(1);
    expect(String(rec.props.fillStyle ?? '')).toContain('255, 0, 0');
  });
});
