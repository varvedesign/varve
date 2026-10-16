import { describe, expect, it } from 'vitest';
import {
  containFit,
  HANDOUT_PAPER_PT,
  type PresentationHandoutOptions,
  planPresentationHandout,
} from './handouts';

const WIDESCREEN = { wPx: 1920, hPx: 1080 };
const CLASSIC = { wPx: 1440, hPx: 1080 };

function options(overrides: Partial<PresentationHandoutOptions> = {}): PresentationHandoutOptions {
  return {
    layout: '3-up',
    paper: 'a4',
    orientation: 'portrait',
    marginPt: 36,
    gapPt: 18,
    slideNumbers: true,
    noteLines: true,
    ...overrides,
  };
}

describe('planPresentationHandout', () => {
  it('lays the classic 3-up out with a ruled note column beside the slides', () => {
    const pages = planPresentationHandout(
      Array.from({ length: 6 }, () => WIDESCREEN),
      options(),
    );
    expect(pages).toHaveLength(2);
    const first = pages[0]!;
    expect(first.slots).toHaveLength(3);
    expect(first.slots.map((slot) => slot.slideIndex)).toEqual([0, 1, 2]);
    // Slides stack vertically in the left two-thirds; the right column rules.
    expect(first.slots[0]!.xPt).toBe(36);
    expect(first.slots[0]!.yPt).toBeLessThan(first.slots[1]!.yPt);
    expect(first.noteLines).toBeDefined();
    expect(first.noteLines!.xPt).toBeGreaterThan(first.slots[0]!.xPt + first.slots[0]!.wPt);
    expect(first.noteLines!.lineCount).toBeGreaterThan(10);
    // Each slide keeps its aspect inside the slot.
    for (const slot of first.slots) {
      expect(slot.wPt / slot.hPt).toBeCloseTo(16 / 9, 2);
    }
  });

  it('numbers pages from one and fills complete pages before starting the next', () => {
    const pages = planPresentationHandout(
      Array.from({ length: 7 }, () => WIDESCREEN),
      options({ layout: '4-up', noteLines: false }),
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]!.slots.map((slot) => slot.slideIndex)).toEqual([0, 1, 2, 3]);
    expect(pages[1]!.slots.map((slot) => slot.slideIndex)).toEqual([4, 5, 6]);
    expect(pages[0]!.pageNumber).toBe(1);
    expect(pages[1]!.pageNumber).toBe(2);
  });

  it('handles a 9-up grid and letter paper landscape', () => {
    const pages = planPresentationHandout(
      Array.from({ length: 9 }, () => WIDESCREEN),
      options({
        layout: '9-up',
        paper: 'letter',
        orientation: 'landscape',
        noteLines: false,
      }),
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.widthPt).toBe(HANDOUT_PAPER_PT.letter.h);
    expect(page.heightPt).toBe(HANDOUT_PAPER_PT.letter.w);
    expect(page.slots).toHaveLength(9);
    // Grid is 3 columns: slot columns start at three distinct x values.
    const xs = new Set(page.slots.map((slot) => Math.round(slot.xPt)));
    expect(xs.size).toBe(3);
  });

  it('contain-fits mixed slide sizes per slot without cropping either', () => {
    const pages = planPresentationHandout(
      [WIDESCREEN, CLASSIC, CLASSIC],
      options({ layout: '4-up', noteLines: false }),
    );
    expect(pages).toHaveLength(1);
    const slots = pages[0]!.slots;
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.xPt).toBeGreaterThanOrEqual(36);
      expect(slot.yPt).toBeGreaterThanOrEqual(36);
      expect(slot.xPt + slot.wPt).toBeLessThanOrEqual(HANDOUT_PAPER_PT.a4.w - 36 + 0.01);
      expect(slot.yPt + slot.hPt).toBeLessThanOrEqual(HANDOUT_PAPER_PT.a4.h - 36 + 0.01);
    }
    expect(slots[1]!.wPt / slots[1]!.hPt).toBeCloseTo(4 / 3, 2);
  });

  it('returns no pages for an empty deck', () => {
    expect(planPresentationHandout([], options())).toEqual([]);
  });
});

describe('containFit', () => {
  it('centers and never upscales beyond the slot', () => {
    const fit = containFit(1920, 1080, 300, 300);
    expect(fit.w).toBeCloseTo(300, 5);
    expect(fit.h).toBeCloseTo(168.75, 2);
    expect(fit.dx).toBeCloseTo(0, 5);
    expect(fit.dy).toBeCloseTo((300 - 168.75) / 2, 2);
  });

  it('degenerates safely on zero sizes', () => {
    expect(containFit(0, 0, 300, 300)).toEqual({ w: 0, h: 0, dx: 0, dy: 0 });
  });
});
