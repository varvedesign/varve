/** replayIr: bezier path fill/stroke curves and open-path endpoint tangents. */
import { describe, expect, it, vi } from 'vitest';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import { recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('renders endpoint markers on open paths using endpoint tangents', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
            weight: 4,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'butt',
            join: 'round',
            miterLimit: 4,
            visible: true,
            arrowStart: 'circle',
            arrowEnd: 'diamond',
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 40] },
            { x: 100, y: 50, handleIn: [-30, -10], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.target.fill).toHaveBeenCalled();
    expect(m.rotate).toHaveBeenCalledTimes(2);
  });

  it('renders a path primitive via bezierCurveTo + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 255, a: 255 },
      primitive: {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: [10, 0] },
          { x: 50, y: 50, handleIn: [-10, 0], handleOut: null },
        ],
        closed: false,
        tolerance: 1,
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('bezierCurveTo(6)');
    expect(rec.calls).toContain('fill(0)');
  });

  // ── Bezier path rendering: single-handle transitions ───────────────

  /** Create a minimal ReplayTarget mock with spy-able methods. */
  function mockTarget(): {
    target: ReplayTarget;
    bezierCurveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
  } {
    const bezierCurveTo = vi.fn();
    const lineTo = vi.fn();
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const fill = vi.fn();
    const stroke = vi.fn();
    const rotate = vi.fn();
    return {
      target: {
        save: vi.fn(),
        restore: vi.fn(),
        clip: vi.fn(),
        transform: vi.fn(),
        translate: vi.fn(),
        rotate,
        scale: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        rect: vi.fn(),
        beginPath: vi.fn(),
        ellipse: vi.fn(),
        arc: vi.fn(),
        moveTo: vi.fn(),
        lineTo,
        bezierCurveTo,
        roundRect: vi.fn(),
        fill,
        stroke,
        closePath: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        drawImage: vi.fn(),
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'round' as CanvasLineCap,
        lineJoin: 'miter' as CanvasLineJoin,
        strokeStyle: '',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        filter: 'none',
        lineDashOffset: 0,
        font: '',
        textAlign: 'left' as CanvasTextAlign,
        textBaseline: 'alphabetic' as CanvasTextBaseline,
      },
      bezierCurveTo,
      lineTo,
      drawImage,
      fillRect,
      fill,
      stroke,
      rotate,
    };
  }

  it('path fill with only handleOut on prev anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with only handleIn on current anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with handles on both anchors uses proper bezier', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 255, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('path fill with no handles uses straight line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 128, b: 0, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.lineTo).toHaveBeenCalled();
    expect(m.bezierCurveTo).not.toHaveBeenCalled();
  });

  it('bezier stroke with only handleOut on prev anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: [20, 30] },
            { x: 100, y: 100, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('bezier stroke with only handleIn on current anchor uses bezier not line', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: [-20, -30], handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalled();
    expect(m.lineTo).not.toHaveBeenCalled();
  });

  it('bezier stroke control points are absolute (anchor + handle offset), not relative', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        strokes: [
          {
            color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
            weight: 2,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'round',
            join: 'round',
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: [30, 40] },
            { x: 100, y: 200, handleIn: null, handleOut: null },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // cp1 = anchor + handleOut = (10+30, 20+40) = (40, 60)
    // cp2 = degenerate: pt (100, 200)
    // end = (100, 200)
    expect(m.bezierCurveTo).toHaveBeenCalledWith(40, 60, 100, 200, 100, 200);
  });

  it('preserves a curved closing segment instead of replacing it with closePath', () => {
    const m = mockTarget();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0],
        fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        primitive: {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: [0, -20], handleOut: [20, 0] },
            { x: 100, y: 0, handleIn: [-20, 0], handleOut: [0, 20] },
          ],
          closed: true,
          tolerance: 1,
        },
      },
    ]);
    expect(m.bezierCurveTo).toHaveBeenCalledTimes(2);
  });
});
