import { describe, expect, it } from 'vitest';
import { addChild, addNode, createDocument, makeFrameNode } from './index';
import { DARK_TEXT_INK, defaultTextFillAt, LIGHT_TEXT_INK } from './textInk';

// F-09 (shell audit 2026-10-21): new text was always rgb(16, 21, 31), so on
// the dark-theme canvas it was effectively invisible. The default ink now
// follows what the text is typed onto.
const DARK_BOARD = { r: 11, g: 14, b: 20 };
const LIGHT_BOARD = { r: 236, g: 238, b: 243 };

describe('defaultTextFillAt', () => {
  it('uses light ink on a dark canvas and dark ink on a light one', () => {
    const doc = createDocument();
    expect(defaultTextFillAt(doc, null, DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
    expect(defaultTextFillAt(doc, null, LIGHT_BOARD)).toEqual(DARK_TEXT_INK);
  });

  it('prefers the document canvas background over the theme board', () => {
    const doc = {
      ...createDocument(),
      canvasBackground: { space: 'rgb' as const, r: 250, g: 250, b: 250, a: 255 },
    };
    expect(defaultTextFillAt(doc, null, DARK_BOARD)).toEqual(DARK_TEXT_INK);
  });

  it('reads the nearest opaque frame fill, so text in a light frame stays dark in dark mode', () => {
    let doc = createDocument();
    const outer = makeFrameNode('outer', { fill: { space: 'rgb', r: 20, g: 20, b: 24, a: 255 } });
    const inner = makeFrameNode('inner', {
      fill: { space: 'rgb', r: 240, g: 240, b: 240, a: 255 },
    });
    doc = addNode(doc, outer);
    doc = addChild(doc, 'outer', inner);
    expect(defaultTextFillAt(doc, 'inner', DARK_BOARD)).toEqual(DARK_TEXT_INK);
    expect(defaultTextFillAt(doc, 'outer', LIGHT_BOARD)).toEqual(LIGHT_TEXT_INK);
  });

  it('looks through transparent frames to what is behind them', () => {
    let doc = createDocument();
    doc = addNode(
      doc,
      makeFrameNode('clear', { fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 0 } }),
    );
    expect(defaultTextFillAt(doc, 'clear', DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
  });

  it('keeps both inks legible against the surface they were chosen for', () => {
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(ratio(luminance(LIGHT_TEXT_INK), luminance(DARK_BOARD))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(luminance(DARK_TEXT_INK), luminance(LIGHT_BOARD))).toBeGreaterThanOrEqual(4.5);
  });
});
