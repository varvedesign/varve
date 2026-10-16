/**
 * Handout imposition planning.
 *
 * A handout is an imposed page layout over slides: N slides per paper page in
 * a fixed grid, each fitted inside its slot without cropping, with optional
 * slide numbers, note-taking lines (the classic 3-up), and page header and
 * footer text. The planner is pure: it consumes slide pixel sizes and options
 * and produces paper-space page plans in PDF points, which the export adapter
 * draws. Mixed slide sizes are handled per slot by contain-fitting each slide
 * into its own slot.
 */

/** Paper sizes in PDF points (72 pt = 1 inch). */
export const HANDOUT_PAPER_PT = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
} as const;

export type HandoutPaperId = keyof typeof HANDOUT_PAPER_PT;

export type PresentationHandoutLayout = '1-up' | '2-up' | '3-up' | '4-up' | '6-up' | '9-up';

export interface PresentationHandoutOptions {
  layout: PresentationHandoutLayout;
  paper: HandoutPaperId;
  orientation: 'portrait' | 'landscape';
  /** Page margin in points on every side. */
  marginPt: number;
  /** Gap between slots in points. */
  gapPt: number;
  slideNumbers: boolean;
  /** Draw ruled note-taking lines beside each slide (classic 3-up). */
  noteLines: boolean;
  headerText?: string;
  footerText?: string;
}

export interface PresentationHandoutSlot {
  /** Contain-fit slide rectangle in page points, origin top-left. */
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  /** Index into the export's included slide list. */
  slideIndex: number;
}

export interface PresentationHandoutNoteLines {
  xPt: number;
  /** First rule position (top), top-left origin. */
  yPt: number;
  wPt: number;
  lineCount: number;
  spacingPt: number;
}

export interface PresentationHandoutPage {
  widthPt: number;
  heightPt: number;
  slots: PresentationHandoutSlot[];
  noteLines?: PresentationHandoutNoteLines;
  /** Human page number starting at 1, for numbering text. */
  pageNumber: number;
}

export const HANDOUT_LAYOUTS: readonly PresentationHandoutLayout[] = [
  '1-up',
  '2-up',
  '3-up',
  '4-up',
  '6-up',
  '9-up',
];

const GRID: Record<PresentationHandoutLayout, { cols: number; rows: number }> = {
  '1-up': { cols: 1, rows: 1 },
  '2-up': { cols: 1, rows: 2 },
  '3-up': { cols: 1, rows: 3 },
  '4-up': { cols: 2, rows: 2 },
  '6-up': { cols: 2, rows: 3 },
  '9-up': { cols: 3, rows: 3 },
};

export const DEFAULT_HANDOUT_OPTIONS: PresentationHandoutOptions = {
  layout: '3-up',
  paper: 'a4',
  orientation: 'portrait',
  marginPt: 36,
  gapPt: 18,
  slideNumbers: true,
  noteLines: true,
};

export interface SlidePixelSize {
  wPx: number;
  hPx: number;
}

/**
 * Plans the whole handout. Slides flow in order, left-to-right then
 * top-to-bottom, filling pages completely before starting the next; the last
 * page keeps only the slots it needs, leaving the rest of the paper empty.
 */
export function planPresentationHandout(
  slides: readonly SlidePixelSize[],
  options: PresentationHandoutOptions,
): PresentationHandoutPage[] {
  const paper = HANDOUT_PAPER_PT[options.paper];
  const widthPt = options.orientation === 'portrait' ? paper.w : paper.h;
  const heightPt = options.orientation === 'portrait' ? paper.h : paper.w;
  const { cols, rows } = GRID[options.layout];
  const safeMargin = Math.max(0, options.marginPt);
  const safeGap = Math.max(0, options.gapPt);
  const gridWidth = widthPt - safeMargin * 2 - (cols - 1) * safeGap;
  const gridHeight = heightPt - safeMargin * 2 - (rows - 1) * safeGap;
  const slotW = gridWidth / cols;
  const slotH = gridHeight / rows;

  const perPage = cols * rows;
  const pageCount = Math.ceil(slides.length / perPage);
  const pages: PresentationHandoutPage[] = [];

  // The classic 3-up reserves the right column for ruled note lines.
  const withNoteColumn = options.noteLines && options.layout === '3-up';

  for (let page = 0; page < pageCount; page++) {
    const slots: PresentationHandoutSlot[] = [];
    const slideColumnWidth = withNoteColumn ? slotW * (2 / 3) : slotW;
    for (let cell = 0; cell < perPage; cell++) {
      const slideIndex = page * perPage + cell;
      const size = slides[slideIndex];
      if (!size) break;
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      const x = safeMargin + col * (slideColumnWidth + safeGap);
      const y = safeMargin + row * (slotH + safeGap);
      const fitted = containFit(size.wPx, size.hPx, slideColumnWidth, slotH);
      slots.push({
        xPt: x + fitted.dx,
        yPt: y + fitted.dy,
        wPt: fitted.w,
        hPt: fitted.h,
        slideIndex,
      });
    }
    // The classic 3-up reserves a ruled note column beside the slides.
    const noteLines: PresentationHandoutNoteLines | undefined = withNoteColumn
      ? {
          xPt: safeMargin + slideColumnWidth + safeGap,
          yPt: safeMargin,
          wPt: widthPt - safeMargin * 2 - slideColumnWidth - safeGap,
          lineCount: Math.max(1, Math.floor((heightPt - safeMargin * 2) / 28)),
          spacingPt: 28,
        }
      : undefined;
    pages.push({
      widthPt,
      heightPt,
      slots,
      ...(noteLines ? { noteLines } : {}),
      pageNumber: page + 1,
    });
  }
  return pages;
}

export function containFit(
  wPx: number,
  hPx: number,
  maxW: number,
  maxH: number,
): { w: number; h: number; dx: number; dy: number } {
  if (wPx <= 0 || hPx <= 0 || maxW <= 0 || maxH <= 0) {
    return { w: 0, h: 0, dx: 0, dy: 0 };
  }
  const scale = Math.min(maxW / wPx, maxH / hPx);
  const w = wPx * scale;
  const h = hPx * scale;
  return { w, h, dx: (maxW - w) / 2, dy: (maxH - h) / 2 };
}
