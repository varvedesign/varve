import { describe, expect, it } from 'vitest';
import { itemizeParagraph } from './text/paragraphs';
import {
  buildTextLayoutSnapshot,
  hitTestTextLayout,
  layoutText,
  selectionRects,
  TextLayoutSnapshotCache,
} from './textLayoutSnapshot';
import type { ShapedRun, TextShaping } from './types';

function makeShaping(text: string, width = 10): TextShaping {
  const run: ShapedRun = {
    fontFamily: 'Test Sans',
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    direction: 'ltr',
    level: 0,
    script: 'latn',
    glyphs: [...text].map((_, index) => ({
      glyphId: index + 1,
      xAdvance: width,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      clusterUtf16: index,
    })),
    width: [...text].length * width,
    ascent: 12,
    descent: 4,
  };
  return {
    runs: [run],
    visualRuns: [run],
    width: run.width,
    height: 16,
    baseDirection: 'ltr',
    direction: 'ltr',
  };
}

describe('TextLayoutSnapshot', () => {
  it('retains logical source text while producing line and caret geometry', () => {
    const snapshot = buildTextLayoutSnapshot('abcd', makeShaping('abcd'), {
      maxWidth: 25,
      sourceRevision: 'doc:1',
      fontRevision: 'font:1',
    });

    expect(snapshot.text).toBe('abcd');
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]?.width).toBe(20);
    expect(snapshot.lines[1]?.sourceStart).toBe(2);
    expect(snapshot.caretStops.some((stop) => stop.offset === 2 && stop.lineIndex === 1)).toBe(
      true,
    );
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('breaks plain text on an explicit newline even when it fits maxWidth', () => {
    // Regression: plain text was itemized as a single paragraph, so wrapLines
    // — which only breaks on maxWidth — never saw the U+000A, and the canvas
    // painted just the first line while still measuring at full height.
    const snapshot = buildTextLayoutSnapshot('ab\ncd', makeShaping('ab\ncd'), { maxWidth: 1000 });

    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]?.paragraphIndex).toBe(0);
    expect(snapshot.lines[1]?.paragraphIndex).toBe(1);
    // Document-local offsets: 'cd' starts after 'ab\n'.
    expect(snapshot.lines[1]?.sourceStart).toBe(3);
    // The newline itself must not paint.
    const glyphCount = snapshot.lines.flatMap((l) => l.runs.flatMap((r) => r.glyphs)).length;
    expect(glyphCount).toBe(4);
    expect(snapshot.lines[1]!.top).toBeGreaterThan(0);
  });

  it('keeps a blank line for consecutive newlines', () => {
    const snapshot = buildTextLayoutSnapshot('a\n\nb', makeShaping('a\n\nb'), { maxWidth: 1000 });

    expect(snapshot.lines).toHaveLength(3);
    expect(snapshot.lines[1]?.runs.flatMap((r) => r.glyphs)).toHaveLength(0);
    expect(snapshot.lines[2]!.top).toBeGreaterThan(snapshot.lines[1]!.top);
  });

  it('uses cluster spans for selection and nearest caret hit testing', () => {
    const snapshot = buildTextLayoutSnapshot('abc', makeShaping('abc'), { maxWidth: 100 });
    expect(selectionRects(snapshot, 1, 3)).toEqual([
      { lineIndex: 0, x: 10, y: 0, width: 20, height: 16 },
    ]);
    expect(hitTestTextLayout(snapshot, 18, 4).offset).toBe(2);
  });

  it('can represent a visual selection as multiple fragments on one line', () => {
    const snapshot = buildTextLayoutSnapshot('abcd', makeShaping('abcd'), { maxWidth: 100 });
    const line = snapshot.lines[0]!;
    const first = line.runs[0]!.glyphs[0]!;
    const third = line.runs[0]!.glyphs[2]!;
    const separated = {
      ...snapshot,
      lines: [
        {
          ...line,
          runs: [
            {
              ...line.runs[0]!,
              glyphs: [
                { ...first, x: 0 },
                { ...third, x: 30, clusterUtf16: 2, sourceEnd: 3 },
              ],
            },
          ],
        },
      ],
    };
    expect(selectionRects(separated, 0, 3)).toHaveLength(2);
  });

  it('bounds cache entries and refreshes least-recently-used order', () => {
    const cache = new TextLayoutSnapshotCache(2);
    const first = buildTextLayoutSnapshot('a', makeShaping('a'), { maxWidth: 100 });
    const second = buildTextLayoutSnapshot('b', makeShaping('b'), { maxWidth: 100 });
    const third = buildTextLayoutSnapshot('c', makeShaping('c'), { maxWidth: 100 });
    cache.set('first', first);
    cache.set('second', second);
    expect(cache.get('first')).toBe(first);
    cache.set('third', third);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('lays out vertical text on the logical inline axis and keeps source offsets', () => {
    const snapshot = buildTextLayoutSnapshot('AあBC', makeShaping('AあBC'), {
      maxWidth: 32,
      lineHeight: 16,
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
    });

    expect(snapshot.text).toBe('AあBC');
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]?.x).toBeGreaterThan(snapshot.lines[1]?.x ?? 0);
    expect(snapshot.lines[0]?.height).toBe(32);
    expect(snapshot.lines[0]?.sourceStart).toBe(0);
    expect(snapshot.lines[1]?.sourceStart).toBe(2);
    expect(snapshot.lines[0]?.runs[0]?.glyphs[0]?.orientation).toBe('sideways');
    expect(snapshot.lines[0]?.runs[0]?.glyphs[1]?.orientation).toBe('upright');

    const caret = hitTestTextLayout(snapshot, snapshot.lines[0]!.x ?? 0, 24);
    expect(caret.offset).toBe(2);
    expect(selectionRects(snapshot, 0, 1)[0]).toMatchObject({
      width: snapshot.lines[0]?.width,
      height: 16,
    });
  });

  it('includes vertical semantics in the snapshot cache identity', () => {
    const horizontal = buildTextLayoutSnapshot('a', makeShaping('a'), { maxWidth: 100 });
    const vertical = buildTextLayoutSnapshot('a', makeShaping('a'), {
      maxWidth: 100,
      writingMode: 'vertical-lr',
    });
    expect(horizontal.identity.writingMode).not.toBe(vertical.identity.writingMode);
    expect(horizontal.identity.textOrientation).toBe('mixed');
  });
});

describe('vertical tate-chu-yoko combined cells', () => {
  const layoutVertical = (text: string, combine: boolean) => {
    const run: ShapedRun = {
      fontFamily: 'Test Sans',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal',
      direction: 'ltr',
      level: 0,
      script: 'latn',
      textCombineUpright: combine || undefined,
      glyphs: [...text].map((_, index) => ({
        glyphId: index + 1,
        xAdvance: 10,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
        clusterUtf16: index,
      })),
      width: text.length * 10,
      ascent: 12,
      descent: 4,
    };
    return layoutText({
      text,
      paragraphs: [
        {
          paragraph: itemizeParagraph({ index: 0, start: 0, end: text.length, text }),
          runs: [run],
        },
      ],
      maxWidth: 64,
      lineHeight: 16,
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
    });
  };

  it('merges a combined digit pair into one measured one-em cell', () => {
    const snapshot = layoutVertical('12', true);
    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.lines[0]?.height).toBe(16);
    const glyphs = snapshot.lines[0]?.runs[0]?.glyphs ?? [];
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toMatchObject({
      clusterUtf16: 0,
      sourceEnd: 2,
      orientation: 'upright',
      // Two 10px digits scaled to fit the 16px cell.
      combinedScale: 0.8,
    });
    // Ligature-style caret policy: stops at the span edges only.
    const stopOffsets = new Set(snapshot.caretStops.map((stop) => stop.offset));
    expect(stopOffsets.has(0)).toBe(true);
    expect(stopOffsets.has(2)).toBe(true);
    expect(stopOffsets.has(1)).toBe(false);
  });

  it('keeps unflagged digits as separate upright cells', () => {
    const snapshot = layoutVertical('12', false);
    const glyphs = snapshot.lines[0]?.runs[0]?.glyphs ?? [];
    expect(glyphs).toHaveLength(2);
    expect(snapshot.lines[0]?.height).toBe(32);
    expect(glyphs[0]?.combinedScale).toBeUndefined();
  });

  it('caps combined runs at four clusters and wraps the remainder', () => {
    const snapshot = layoutVertical('12345', true);
    const glyphs = snapshot.lines[0]?.runs[0]?.glyphs ?? [];
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]?.clusterUtf16).toBe(0);
    expect(glyphs[0]?.sourceEnd).toBe(4);
    expect(glyphs[1]?.clusterUtf16).toBe(4);
    expect(glyphs[1]?.sourceEnd).toBe(5);
    expect(snapshot.lines[0]?.height).toBe(32);
  });

  it('never combines in horizontal writing mode', () => {
    const run: ShapedRun = {
      fontFamily: 'Test Sans',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal',
      direction: 'ltr',
      level: 0,
      script: 'latn',
      textCombineUpright: true,
      glyphs: [
        { glyphId: 1, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
        { glyphId: 2, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 1 },
      ],
      width: 20,
      ascent: 12,
      descent: 4,
    };
    const snapshot = layoutText({
      text: '12',
      paragraphs: [
        {
          paragraph: itemizeParagraph({ index: 0, start: 0, end: 2, text: '12' }),
          runs: [run],
        },
      ],
      maxWidth: 64,
      lineHeight: 16,
    });
    const glyphs = snapshot.lines[0]?.runs[0]?.glyphs ?? [];
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]?.combinedScale).toBeUndefined();
  });
});
