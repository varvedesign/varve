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
describe('stroke rendering', () => {
  it('renders a gradient stroke through the same affine evaluator as fills', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 3,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
          gradient: {
            type: 'linear',
            stops: [
              { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
            ],
            transform: [100, 25, 20, 40, 5, 10],
          },
        },
      ],
      primitive: { kind: 'line', from: [0, 0], to: [100, 50], tolerance: 1 },
    };

    replayIr(rec.target, [item]);

    expect(rec.calls).not.toContain('transform(100,25,20,40,5,10)');
    expect(rec.calls).toContain('createLinearGradient(15,30,115,55)');
    expect(rec.calls.some((call) => call.startsWith('stroke('))).toBe(true);
  });

  it('renders rect stroke via strokeRect', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 2,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(true);
  });

  it('rect stroke with cornerRadius uses roundRect path for stroke', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30, cornerRadius: 8 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('roundRect('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('strokeRect('))).toBe(false);
  });

  it('renders ellipse stroke via path', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 3,
          cap: 'round',
          join: 'round',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(true);
    expect(rec.calls.some((c) => c === 'set lineWidth')).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('ellipse('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });

  it('stroke with dash pattern applies setLineDash', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          weight: 1,
          cap: 'butt',
          join: 'miter',
          dashPattern: [5, 5],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('setLineDash('))).toBe(true);
  });

  it('invisible stroke is skipped', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          weight: 5,
          cap: 'butt',
          join: 'miter',
          dashPattern: [],
          dashOffset: 0,
          miterLimit: 4,
          align: 'center',
          visible: false,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c === 'set strokeStyle')).toBe(false);
  });

  it('line stroke matches from→to', () => {
    const rec = recorder();
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      strokes: [
        {
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
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
      primitive: { kind: 'line', from: [0, 0], to: [100, 50], tolerance: 1 },
    };
    replayIr(rec.target, [item]);
    expect(rec.calls.some((c) => c.startsWith('moveTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('lineTo('))).toBe(true);
    expect(rec.calls.some((c) => c.startsWith('stroke('))).toBe(true);
  });
});
