import { resolveTextGeometry, setTextAdvanceMeasurer } from '@varve/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTextLayoutSnapshot } from './textLayoutSnapshot';
import type { ShapedRun, TextShaping } from './types';

/**
 * The contour (balloon) contract: the scene geometry resolver in
 * `@varve/shared` and the canonical painter in the engine must break the same
 * logical text into the same lines when handed the same per-line width
 * profile. These tests exist so a future refactor cannot silently make
 * selection disagree with paint inside a balloon.
 */

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

const LINE_HEIGHT = 16 * 1.4;

afterEach(() => {
  setTextAdvanceMeasurer(null);
});

/**
 * Shared geometry measures through the installed advance backend; the engine
 * test shaping uses 10px per glyph, so the parity harness installs a matching
 * measurer. Without it the shared estimator would use different advances and
 * the comparison would be meaningless.
 */
function installMonospaceMeasurer(): void {
  setTextAdvanceMeasurer({
    measureAdvance: (text: string) => text.length * 10,
    revision: () => 'balloon-parity',
  });
}

function sharedLineTexts(text: string, w: number, h: number): string[] {
  return resolveTextGeometry({
    text,
    w,
    h,
    fontSize: 16,
    fontFamily: 'Test Sans',
    lineHeight: 1.4,
    textResizing: 'fixed',
    textWrapShape: 'ellipse',
  }).lines.map((line) => line.text.trimEnd());
}

function engineLineTexts(text: string, w: number): string[] {
  const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
    maxWidth: w,
    wrapShape: 'ellipse',
    lineHeight: LINE_HEIGHT,
  });
  return snapshot.lines.map((line) => text.slice(line.sourceStart, line.sourceEnd).trimEnd());
}

describe('balloon contour wrapping (engine)', () => {
  it('honours each line limit and moves whole words to a wider line', () => {
    const text = 'aaaa bbbb cccc dddd';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 120,
      lineWidths: [40, 120],
      lineHeight: LINE_HEIGHT,
    });
    const lines = snapshot.lines.map((line) =>
      text.slice(line.sourceStart, line.sourceEnd).trimEnd(),
    );
    expect(lines).toEqual(['aaaa', 'bbbb cccc', 'dddd']);
    expect(snapshot.identity.lineWidthsKey).toBe('40,120');
  });

  it('keeps a box-fitting word whole on a narrower crown instead of splitting it', () => {
    installMonospaceMeasurer();
    const text = 'aaaaaaaa bbbb';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 120,
      lineWidths: [40, 120],
      lineHeight: LINE_HEIGHT,
    });
    const lines = snapshot.lines.map((line) =>
      text.slice(line.sourceStart, line.sourceEnd).trimEnd(),
    );
    expect(lines[0]).toBe('aaaaaaaa');
    expect(lines.some((line) => line === 'aaaa' || line === 'aaaaaaaa'.slice(0, 4))).toBe(false);
    expect(sharedLineTexts(text, 120, 80)[0]?.trim()).toBe('aaaaaaaa');
  });

  it('does not measure the crown row against a later chord', () => {
    // Stealing the equator width for a line that still paints at the crown
    // sat "aaaa bbbb" (90px) on the 40px first row and poked outside.
    const text = 'aaaa bbbb';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 120,
      lineWidths: [40, 120],
      lineHeight: LINE_HEIGHT,
    });
    const lines = snapshot.lines.map((line) =>
      text.slice(line.sourceStart, line.sourceEnd).trimEnd(),
    );
    expect(lines).toEqual(['aaaa', 'bbbb']);
  });

  it('stays rectangular when no profile is supplied', () => {
    const text = 'aaaa bbbb cccc dddd';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 100,
      lineHeight: LINE_HEIGHT,
    });
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.identity.lineWidthsKey).toBe('');
  });

  it('distinguishes profile and rectangle in the snapshot cache identity keys', () => {
    const text = 'aaaa bbbb cccc dddd';
    const shaped = makeShaping(text);
    const profiled = buildTextLayoutSnapshot(text, shaped, {
      maxWidth: 120,
      lineWidths: [40, 120],
    });
    const rectangular = buildTextLayoutSnapshot(text, shaped, { maxWidth: 120 });
    expect(profiled.identity.lineWidthsKey).not.toBe(rectangular.identity.lineWidthsKey);
  });
});

describe('balloon contour wrapping parity (shared geometry vs engine paint)', () => {
  it('breaks natural dialogue into identical lines', () => {
    installMonospaceMeasurer();
    const text =
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.';
    expect(engineLineTexts(text, 200)).toEqual(sharedLineTexts(text, 200, 160));
  });

  it('agrees on a short paragraph where the profile barely bites', () => {
    installMonospaceMeasurer();
    const text = 'No, that is not what I meant at all.';
    expect(engineLineTexts(text, 240)).toEqual(sharedLineTexts(text, 240, 200));
  });

  it('agrees when a localized replacement expands the same balloon', () => {
    installMonospaceMeasurer();
    const text =
      'Nein, das habe ich überhaupt nicht so gemeint — ich wollte nur sichergehen, dass wir uns verstehen.';
    expect(engineLineTexts(text, 220)).toEqual(sharedLineTexts(text, 220, 180));
  });

  it('keeps a spaced punctuation mark on the previous line', () => {
    installMonospaceMeasurer();
    const text = 'Wait \u2014 what?';
    // 10px/char: "Wait " is 50px, so the mark does not fit a 50px chord.
    const engine = engineLineTexts(text, 50);
    const shared = sharedLineTexts(text, 50, 400);
    expect(engine).toEqual(shared);
    expect(engine.some((line) => line.trim() === '\u2014')).toBe(false);
  });

  it('agrees across 30-160px and does not mid-word-break a word that fits the box', () => {
    // The w=200 cases above miss the crown: at 55-90px the shared layout
    // used to char-break "something" and orphan "." while the painter kept
    // the token. Sweep the same dialogue at every width in the range.
    installMonospaceMeasurer();
    const CHAR = 10;
    const corpus = [
      'something something something something',
      'SNAP. WHATEVER.',
      'run.',
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.',
      'No, that is not what I meant at all.',
      'Wait \u2014 what?',
      'Hi ... there',
      'a - b - c',
      'Ok , fine .',
      'x \u2014 y \u2014 z',
    ];
    const mismatches: string[] = [];
    const midWord: string[] = [];
    for (const text of corpus) {
      const fittingWords = text.split(/\s+/).filter(Boolean);
      for (let width = 30; width <= 160; width += 1) {
        const engine = engineLineTexts(text, width);
        const shared = sharedLineTexts(text, width, 400);
        if (engine.join('\n') !== shared.join('\n')) {
          mismatches.push(
            `${width}px ${JSON.stringify(text)} engine=${JSON.stringify(engine)} shared=${JSON.stringify(shared)}`,
          );
        }
        const painted = [...engine, ...shared].flatMap((line) =>
          line.trim().split(/\s+/).filter(Boolean),
        );
        for (const word of fittingWords) {
          if (word.length * CHAR > width) continue;
          if (painted.includes(word)) continue;
          midWord.push(`${width}px split ${JSON.stringify(word)} lines=${JSON.stringify(engine)}`);
        }
      }
    }
    expect(mismatches.slice(0, 8)).toEqual([]);
    expect(midWord.slice(0, 8)).toEqual([]);
    expect(mismatches).toHaveLength(0);
    expect(midWord).toHaveLength(0);
  });
});
