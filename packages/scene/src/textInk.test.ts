import { describe, expect, it } from 'vitest';
import {
  addChild,
  addNode,
  createDocument,
  gradientFill,
  makeFrameNode,
  makePaint,
  solidFill,
} from './index';
import { DARK_TEXT_INK, defaultTextFillAt, LIGHT_TEXT_INK } from './textInk';

// F-09 (shell audit 2026-10-21): new text was always rgb(16, 21, 31), so on
// the dark-theme canvas it was effectively invisible. The default ink now
// follows what the text is typed onto.
const DARK_BOARD = { r: 11, g: 14, b: 20 };
const LIGHT_BOARD = { r: 236, g: 238, b: 243 };
const WHITE = { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 };
const BLACK = { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };

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

  it('keeps the same ink when a legacy solid is represented as a fill stack', () => {
    const frame = makeFrameNode('paper', { fill: WHITE });
    const legacy = addNode(createDocument(), frame);
    const stacked = addNode(createDocument(), { ...frame, fills: [solidFill(WHITE)] });
    expect(defaultTextFillAt(legacy, frame.id, DARK_BOARD)).toEqual(DARK_TEXT_INK);
    expect(defaultTextFillAt(stacked, frame.id, DARK_BOARD)).toEqual(DARK_TEXT_INK);
  });

  it.each([
    { label: 'opaque upper fill', fills: [solidFill(BLACK), solidFill(WHITE)], ink: DARK_TEXT_INK },
    {
      label: 'hidden upper fill',
      fills: [solidFill(BLACK), solidFill(WHITE, { visible: false })],
      ink: LIGHT_TEXT_INK,
    },
    {
      label: 'transparent upper fill',
      fills: [solidFill(WHITE), solidFill(BLACK, { opacity: 0 })],
      ink: DARK_TEXT_INK,
    },
    {
      label: 'translucent upper fill',
      fills: [solidFill(BLACK), solidFill(WHITE, { opacity: 0.1 })],
      ink: LIGHT_TEXT_INK,
    },
    {
      label: 'translucent dark over white',
      fills: [solidFill(WHITE), solidFill(BLACK, { opacity: 0.1 })],
      ink: DARK_TEXT_INK,
    },
    {
      label: 'colour alpha and fill opacity together',
      fills: [solidFill({ ...WHITE, a: 128 }, { opacity: 0.2 })],
      ink: LIGHT_TEXT_INK,
    },
  ])('uses visible paint order and alpha: $label', ({ fills, ink }) => {
    const frame = { ...makeFrameNode('paper', { fill: WHITE }), fills };
    const doc = addNode(createDocument(), frame);
    expect(defaultTextFillAt(doc, frame.id, DARK_BOARD)).toEqual(ink);
  });

  it('composites a translucent fill stack over its enclosing frame', () => {
    let doc = addNode(createDocument(), makeFrameNode('outer', { fill: WHITE }));
    doc = addChild(doc, 'outer', {
      ...makeFrameNode('inner', { fill: BLACK }),
      fills: [solidFill(BLACK, { opacity: 0.1 })],
    });
    expect(defaultTextFillAt(doc, 'inner', DARK_BOARD)).toEqual(DARK_TEXT_INK);
  });

  it('resolves shared solid paints before inline or legacy fills', () => {
    const doc = addNode(
      {
        ...createDocument(),
        paints: { paper: makePaint('paper', 'Paper', solidFill(WHITE)) },
      },
      {
        ...makeFrameNode('frame', { fill: BLACK }),
        fills: [solidFill(BLACK)],
        paintRefs: ['paper'],
      },
    );
    expect(defaultTextFillAt(doc, 'frame', DARK_BOARD)).toEqual(DARK_TEXT_INK);
  });

  it('does not fall back to stale inline paint when a shared paint is missing', () => {
    const doc = addNode(createDocument(), {
      ...makeFrameNode('frame', { fill: WHITE }),
      fills: [solidFill(WHITE)],
      paintRefs: ['missing'],
    });
    expect(defaultTextFillAt(doc, 'frame', DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
  });

  it('keeps the documented fallback for a blend-dependent surface', () => {
    const doc = addNode(createDocument(), {
      ...makeFrameNode('frame', { fill: WHITE }),
      fills: [solidFill(WHITE, { blendMode: 'multiply' })],
    });
    expect(defaultTextFillAt(doc, 'frame', DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
  });

  it('applies frame opacity to the combined paints only once', () => {
    const doc = addNode(createDocument(), {
      ...makeFrameNode('frame', { opacity: 0.1 }),
      fills: [solidFill(WHITE), solidFill(WHITE)],
    });
    expect(defaultTextFillAt(doc, 'frame', DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
  });

  it('only looks through a gradient when no opaque solid covers it', () => {
    const gradient = gradientFill('linear', [
      { position: 0, color: WHITE },
      { position: 1, color: BLACK },
    ]);
    const frame = makeFrameNode('frame', { fill: WHITE });
    const covered = addNode(createDocument(), { ...frame, fills: [gradient, solidFill(WHITE)] });
    const exposed = addNode(createDocument(), { ...frame, fills: [solidFill(WHITE), gradient] });
    expect(defaultTextFillAt(covered, 'frame', DARK_BOARD)).toEqual(DARK_TEXT_INK);
    expect(defaultTextFillAt(exposed, 'frame', DARK_BOARD)).toEqual(LIGHT_TEXT_INK);
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
