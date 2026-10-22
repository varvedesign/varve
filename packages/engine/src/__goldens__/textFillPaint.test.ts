/**
 * Text is painted with the item's resolved fill, not the legacy solid colour.
 *
 * OpenPencil #246 reports that a text gradient "is not working". Varve resolves
 * the same `fills` array for text as for any other item, so the check worth
 * keeping is structural: painting must create the gradient and install it as
 * `fillStyle` before the glyphs are drawn. A regression to `item.fill` would
 * still draw plausible black text and would be invisible in a pixel-free test
 * unless the sequence is asserted directly — which is what the draw-call
 * recorder exists for.
 */
import { describe, expect, it } from 'vitest';
import { replayIr } from '../replay';
import type { FillIR, RenderItem } from '../types';
import { createRecordingTarget, formatDrawCallLog } from './drawCallRecorder';

const BLACK = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const;
const RED = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const;
const BLUE = { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } as const;

function gradientFill(): FillIR {
  return {
    type: 'gradient',
    gradientType: 'linear',
    stops: [
      { position: 0, color: RED },
      { position: 1, color: BLUE },
    ],
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function textItem(fills?: FillIR[]): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: BLACK,
    ...(fills ? { fills } : {}),
    primitive: {
      kind: 'text',
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      text: 'Gradient',
      fontSize: 32,
      fontFamily: 'IBM Plex Sans Variable',
      fontWeight: 400,
      fontStyle: 'normal',
      textAlign: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    opacity: 1,
    blendMode: 'normal',
    strokes: [],
    effects: [],
  } as unknown as RenderItem;
}

function record(items: RenderItem[]): string[] {
  const { target, log } = createRecordingTarget();
  replayIr(target, items);
  return formatDrawCallLog(log).split('\n');
}

describe('text fill painting', () => {
  it('fills glyphs with a gradient when the text carries one', () => {
    const lines = record([textItem([gradientFill()])]);

    expect(lines.some((line) => line.includes('createLinearGradient'))).toBe(true);
    // The gradient (an object) is installed as the paint, not a solid colour.
    expect(lines.some((line) => /set fillStyle = \{\}/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes('fillText'))).toBe(true);
    // ...and the legacy solid colour is not used for the glyphs.
    expect(lines.some((line) => line.includes('rgba(0, 0, 0, 1)'))).toBe(false);
  });

  it('fills glyphs with the solid colour when no fills array is present', () => {
    const lines = record([textItem()]);

    expect(lines.some((line) => line.includes('createLinearGradient'))).toBe(false);
    expect(lines.some((line) => line.includes('rgba(0, 0, 0, 1)'))).toBe(true);
    expect(lines.some((line) => line.includes('fillText'))).toBe(true);
  });
});
