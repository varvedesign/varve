/** replayIr: basic shape primitives, fills, and primitive tracing. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { Recorder, recorder } from './replay.test-helpers';
import type { RenderItem } from './types';

describe('replayIr', () => {
  it('replays a rect: save, transform, fillStyle, fillRect, restore', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 10, 20],
      fill: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 5, h: 6 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // Core visual calls. Property resets (shadow, filter, alpha, blend)
    // appear between fillRect and restore.
    const idxFillRect = rec.calls.indexOf('fillRect(4)');
    const idxRestore = rec.calls.indexOf('restore(0)');
    expect(idxFillRect).toBeGreaterThan(0);
    expect(idxRestore).toBeGreaterThan(idxFillRect);
    expect(rec.props.fillStyle).toBe('rgba(57, 208, 198, 1)');
  });

  it('replays an ellipse via beginPath + ellipse + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('ellipse(7)');
    expect(rec.calls).toContain('fill(0)');
  });

  it('replays a line as a stroked segment with tolerance width', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 2 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
    expect(rec.calls).toContain('stroke(0)');
    expect(rec.props.lineWidth).toBe(2);
    expect(rec.props.lineCap).toBe('round');
  });

  it('renders polygon via beginPath + polygon path + closePath + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 128, b: 0, a: 255 },
      primitive: { kind: 'polygon', cx: 50, cy: 50, radius: 40, sides: 6, rotation: 0 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('closePath(0)');
    expect(rec.calls).toContain('fill(0)');
    // moveTo for first vertex, lineTo for remaining sides
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
  });

  it('renders star via beginPath + star path + closePath + fill', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 200, b: 0, a: 255 },
      primitive: {
        kind: 'star',
        cx: 50,
        cy: 50,
        innerRadius: 20,
        outerRadius: 40,
        points: 5,
        rotation: 0,
      },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('closePath(0)');
    expect(rec.calls).toContain('fill(0)');
    expect(rec.calls).toContain('moveTo(2)');
  });

  it('renders arrow as a stroked line with arrowhead', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      primitive: { kind: 'arrow', from: [0, 0], to: [100, 0], tolerance: 1, arrowheadSize: 10 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('beginPath(0)');
    expect(rec.calls).toContain('moveTo(2)');
    expect(rec.calls).toContain('lineTo(2)');
    expect(rec.calls).toContain('stroke(0)');
  });

  it('renders a shape with image fill via the fill painting path', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      fills: [
        {
          type: 'image',
          src: 'data:image/png;base64,abc',
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // Falls through to fillRect placeholder since drawImage unavailable on recorder
    expect(rec.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
  });

  it('renders a rounded rect via roundRect + fill when cornerRadius is set', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 50, cornerRadius: 8 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    // With cornerRadius, must use roundRect path + fill rather than fillRect
    expect(rec.calls).toContain('roundRect(5)');
    expect(rec.calls).toContain('fill(0)');
    expect(rec.calls).not.toContain('fillRect(4)');
  });

  it('renders a rect without cornerRadius via fillRect', () => {
    const item: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 30 },
    };
    const rec = recorder();
    replayIr(rec.target, [item]);
    expect(rec.calls).toContain('fillRect(4)');
  });

  it('frame does not occlude sibling: replay of two independent items preserves both fills', () => {
    // Simulates [frame-background, sibling-shape] IR order
    const frameItem: RenderItem = {
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 400, h: 300 },
    };
    const siblingItem: RenderItem = {
      transform: [1, 0, 0, 1, 50, 50],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    };
    const rec = recorder();
    replayIr(rec.target, [frameItem, siblingItem]);
    // Both items must produce a fillRect call each
    const fillRects = rec.calls.filter((c) => c === 'fillRect(4)');
    expect(fillRects.length).toBe(2);
    // Save/restore must be balanced
    const saves = rec.calls.filter((c) => c === 'save(0)');
    const restores = rec.calls.filter((c) => c === 'restore(0)');
    expect(saves.length).toBe(restores.length);
  });

  it('traceOutline handles ellipse primitive via ellipse() call', () => {
    const rec = new Recorder();
    const effects: RenderItem['effects'] = [
      {
        type: 'innerShadow',
        x: 0,
        y: 0,
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
      primitive: { kind: 'ellipse' as const, cx: 50, cy: 50, rx: 40, ry: 30 },
    };
    replayIr(rec, [item]);
    expect(rec.calls.some((c) => c.startsWith('ellipse('))).toBe(true);
  });
});
