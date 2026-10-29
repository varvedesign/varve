/**
 * Measure area-text overset for preflight.
 *
 * The engine already lays out area text on the canvas, but it discarded the
 * overflow it detected (`hasVerticalOverflow` was only used to decide the
 * ellipsis), so preflight reported `overset-text` as unavailable and a clipped
 * or bleeding frame gave the user no warning. External evidence:
 * vectorcraft#1471 (area type overflow is not reported), #2323 (the overflow
 * indicator appears only once the frame is selected), #2769 (CJK area text
 * clips its last line with no overset indicator).
 *
 * This runs the same canonical layout the renderer uses, with a caller-supplied
 * measure context, and compares each line's box against the frame. It is a
 * preflight-time (on-demand) operation, never part of the paint path.
 */
import {
  layoutRichTextSnapshot,
  type RichTextLayoutDefaults,
  type RichTextMeasureContext,
} from '@varve/engine';
import { type Document, type OversetInfo, plainTextToRichText, type TextNode } from '@varve/scene';

export interface OversetMeasurement {
  /** Overset frames, keyed by node id. */
  map: Map<string, OversetInfo>;
  /** Area frames that could not be measured, by node id. */
  unmeasured: string[];
}

const EMPTY: OversetMeasurement = { map: new Map(), unmeasured: [] };

/**
 * Per-node results. Scene nodes are immutable, so object identity is a sound
 * cache key: an unchanged frame reuses its measurement, and an edited one is a
 * new object. Without this, preflight re-shaped every area frame on every
 * document change.
 */
let cache = new WeakMap<TextNode, OversetInfo | null>();

/** Drop cached results. Call when the measurement context changes, e.g. when
 *  document fonts finish loading and metrics may differ from the fallback. */
export function resetTextOversetCache(): void {
  cache = new WeakMap();
}

/** Nodes whose frame follows the text, so overflow cannot occur. */
function frameFollowsText(node: TextNode): boolean {
  return node.textResizing === 'autoHeight' || node.textResizing === 'autoWidth';
}

function defaultsFor(node: TextNode): RichTextLayoutDefaults {
  return {
    fontFamily: node.fontFamily ?? 'Inter',
    fontReference: node.fontReference,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight ?? 400,
    fontStyle: node.fontStyle ?? 'normal',
    letterSpacing: node.letterSpacing ?? 0,
    tracking: node.tracking ?? 0,
    lineHeight: node.lineHeight,
    direction: 'auto',
    language: node.language,
    openTypeFeatures: node.openTypeFeatures,
    variableAxes: node.variableAxes,
    writingMode: node.writingMode,
    textOrientation: node.textOrientation,
  };
}

/**
 * Measure every measurable area frame in `doc`.
 *
 * Contour-wrapped and vertical frames are reported as unmeasured rather than
 * guessed at: a wrong overset warning is worse than an honest gap, and the
 * preflight check stays `unavailable` while any remain.
 */
export function measureTextOverset(
  doc: Document,
  measure: RichTextMeasureContext,
): OversetMeasurement {
  const map = new Map<string, OversetInfo>();
  const unmeasured: string[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text' || node.textMode !== 'area') continue;
    if (frameFollowsText(node)) continue;
    const width = node.w ?? 0;
    const height = node.h ?? 0;
    if (!(width > 0) || !(height > 0)) continue;
    const writingMode = node.writingMode ?? 'horizontal-tb';
    if (node.textWrapShape || writingMode.startsWith('vertical')) {
      unmeasured.push(node.id);
      continue;
    }

    if (cache.has(node)) {
      const cached = cache.get(node);
      if (cached) map.set(node.id, cached);
      continue;
    }

    const richText = node.richText ?? plainTextToRichText(node.text ?? '');
    if (richText.paragraphs.length === 0) continue;

    const snapshot = layoutRichTextSnapshot(richText, defaultsFor(node), measure, {
      maxWidth: width,
      lineHeight: node.fontSize * (node.lineHeight ?? 1.2),
      paragraphSpacing: node.paragraphSpacing ?? 0,
      language: node.language,
      writingMode: node.writingMode,
      textOrientation: node.textOrientation,
    });

    // A line whose box ends inside the frame is visible.
    const fitted = snapshot.lines.filter((line) => line.top + line.height <= height + 0.5);
    if (fitted.length === snapshot.lines.length) {
      cache.set(node, null);
      continue;
    }

    const fittedChars = fitted.reduce((max, line) => Math.max(max, line.sourceEnd), 0);
    const info: OversetInfo = {
      frameId: node.id,
      oversetChars: Math.max(1, snapshot.text.length - fittedChars),
      isLastFrame: true,
    };
    cache.set(node, info);
    map.set(node.id, info);
  }

  if (map.size === 0 && unmeasured.length === 0) return EMPTY;
  return { map, unmeasured };
}
