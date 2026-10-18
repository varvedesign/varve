import { describe, expect, it } from 'vitest';
import type { ReplayTarget } from './replayTypes';
import { paintStroke } from './strokeReplay';
import type { PathPoint, RenderItem, Stroke } from './types';

function point(x: number, y: number, pressure: number): PathPoint {
  return { x, y, pressure, handleIn: null, handleOut: null };
}

function renderStroke(points: PathPoint[], dashPattern: number[]) {
  const calls = { fill: 0, stroke: 0, lineTo: 0, traceOutline: 0, dashLength: 0 };
  const target = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {
      calls.lineTo++;
    },
    bezierCurveTo() {},
    closePath() {},
    fill() {
      calls.fill++;
    },
    stroke() {
      calls.stroke++;
    },
    setLineDash(pattern: number[]) {
      calls.dashLength = pattern.length;
    },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    lineDashOffset: 0,
    miterLimit: 4,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    font: '10px sans-serif',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    clip() {},
    fillRect() {},
    strokeRect() {},
    rect() {},
    ellipse() {},
    arc() {},
    fillText() {},
    transform() {},
    translate() {},
    rotate() {},
    scale() {},
  } as unknown as ReplayTarget;
  const stroke: Stroke = {
    color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    weight: 12,
    align: 'center',
    dashPattern,
    dashOffset: 0,
    cap: 'butt',
    join: 'miter',
    miterLimit: 4,
    visible: true,
  };
  const item: RenderItem = {
    transform: [1, 0, 0, 1, 0, 0],
    fill: stroke.color,
    primitive: { kind: 'path', points, closed: false, tolerance: 1 },
    strokes: [stroke],
  };
  const primitive = item.primitive;
  if (primitive.kind !== 'path') throw new Error('expected path');
  paintStroke(target, stroke, item, {
    traceOutline: (ctx) => {
      calls.traceOutline++;
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (let index = 1; index < points.length; index++) {
        ctx.lineTo(points[index]!.x, points[index]!.y);
      }
    },
    primitiveBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
    alphaStrokeOps: {} as never,
  });
  return calls;
}

describe('variable-width stroke replay bounds', () => {
  it('does not multiply straight-segment samples by document-unit length', () => {
    const calls = renderStroke([point(0, 0, 0.2), point(1_000_000_000, 0, 0.9)], []);

    expect(calls.fill).toBe(1);
    expect(calls.stroke).toBe(0);
    expect(calls.traceOutline).toBe(0);
    expect(calls.lineTo).toBeLessThan(8);
  });

  it('caps excessive dash expansion with a solid pressure-aware tail', () => {
    const calls = renderStroke([point(0, 0, 0.2), point(1_000_000_000, 0, 0.9)], [2, 2]);

    expect(calls.fill).toBe(1);
    expect(calls.stroke).toBe(0);
    expect(calls.traceOutline).toBe(0);
    expect(calls.lineTo).toBeLessThan(100_000);
  });

  it('preserves long authored dash patterns through the native path stroke', () => {
    const pattern = Array.from({ length: 130 }, (_, index) => (index % 2 === 0 ? 2 : 3));
    const calls = renderStroke([point(0, 0, 0.2), point(100, 0, 0.9)], pattern);

    expect(calls.fill).toBe(0);
    expect(calls.stroke).toBe(1);
    expect(calls.traceOutline).toBe(1);
    expect(calls.dashLength).toBe(130);
  });

  it('bounds dash patterns with no drawable on-runs', () => {
    const calls = renderStroke([point(0, 0, 0.2), point(10, 0, 0.9)], [0, 0.00000001]);

    expect(calls.fill).toBe(0);
    expect(calls.stroke).toBe(1);
    expect(calls.traceOutline).toBe(1);
    expect(calls.dashLength).toBe(2);
  });

  it('falls back when tiny on/off intervals cannot produce bounded outline runs', () => {
    const calls = renderStroke([point(0, 0, 0.2), point(10, 0, 0.9)], [0.00000001, 0.00000001]);

    expect(calls.fill).toBe(0);
    expect(calls.stroke).toBe(1);
    expect(calls.traceOutline).toBe(1);
    expect(calls.dashLength).toBe(2);
  });
});
