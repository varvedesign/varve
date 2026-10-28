/** replayIr: variable-width path strokes and dash phase. */
import { describe, expect, it } from 'vitest';
import { replayIr } from './replay';
import { recorder } from './replay.test-helpers';

describe('replayIr', () => {
  it('variable-width path stroke uses pressure to modulate width', () => {
    const m = recorder();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        opacity: 1,
        blendMode: 'normal',
        strokes: [
          {
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
            weight: 8,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: null, pressure: 0.2 },
            { x: 100, y: 200, handleIn: null, handleOut: null, pressure: 0.8 },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // Variable width is emitted as one filled outline, so translucent samples
    // cannot darken one another at segment overlaps.
    expect(m.calls).toContain('fill(0)');
    expect(m.calls).not.toContain('stroke(0)');
  });

  it('variable-width path stroke with uniform pressure falls back to uniform stroke', () => {
    const m = recorder();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        opacity: 1,
        blendMode: 'normal',
        strokes: [
          {
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
            weight: 8,
            align: 'center' as const,
            dashPattern: [],
            dashOffset: 0,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: null, pressure: 0.5 },
            { x: 100, y: 200, handleIn: null, handleOut: null, pressure: 0.5 },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    // Uniform pressure: only one lineWidth set (not per-segment variable)
    const lineWidthCalls = m.calls.filter((c) => c.startsWith('set lineWidth'));
    expect(lineWidthCalls.length).toBe(1);
  });

  it('keeps dash phase on a variable-width path without segment overpainting', () => {
    const m = recorder();
    replayIr(m.target, [
      {
        transform: [1, 0, 0, 1, 0, 0] as const,
        fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const,
        strokes: [
          {
            color: { space: 'rgb', r: 255, g: 0, b: 0, a: 180 } as const,
            weight: 8,
            align: 'center' as const,
            dashPattern: [12, 6],
            dashOffset: -3,
            cap: 'round' as const,
            join: 'round' as const,
            miterLimit: 4,
            visible: true,
          },
        ],
        primitive: {
          kind: 'path',
          points: [
            { x: 10, y: 20, handleIn: null, handleOut: null, pressure: 0.1 },
            { x: 100, y: 80, handleIn: null, handleOut: null, pressure: 0.9 },
          ],
          closed: false,
          tolerance: 1,
        },
      },
    ]);
    expect(m.calls).toContain('setLineDash(1)');
    expect(m.calls).toContain('fill(0)');
    expect(m.calls).not.toContain('stroke(0)');
  });
});
