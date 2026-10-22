/**
 * Grapheme-safe truncation for user-facing text.
 *
 * Evidence: storytold/lightcraft#266 — a filmstrip label panicked because the
 * code sliced a file name at a byte index. The JavaScript equivalent is not a
 * panic, but it is still a visible defect: `String.prototype.slice` cuts UTF-16
 * code units, so a truncation limit can land inside a surrogate pair or a
 * grapheme cluster and leave a replacement glyph, a broken emoji, or a
 * detached combining mark in a control the user relies on to identify a
 * document ("Close “Quarterly report with a long emoji name…”").
 *
 * Names, messages and previews are arbitrary user text: they can contain CJK,
 * right-to-left scripts, combining marks, emoji, and ZWJ sequences. Truncate
 * by grapheme cluster, never by code unit.
 */

const ELLIPSIS = '\u2026';

let segmenter: Intl.Segmenter | null | undefined;

function graphemeSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  segmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  return segmenter;
}

/** Split into user-perceived characters, with a code-point fallback. */
export function splitGraphemeClusters(value: string): string[] {
  const seg = graphemeSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const { segment } of seg.segment(value)) out.push(segment);
    return out;
  }
  // Without Intl.Segmenter, code points at least keep surrogate pairs intact.
  return Array.from(value);
}

/**
 * Truncate `value` to at most `maxGraphemes` user-perceived characters.
 *
 * The ellipsis counts toward the budget, so the result never exceeds
 * `maxGraphemes`. A value already within budget is returned unchanged (no
 * normalization, no ellipsis). `maxGraphemes <= 0` yields an empty string.
 */
export function truncateGraphemes(value: string, maxGraphemes: number, ellipsis = ELLIPSIS) {
  if (!Number.isFinite(maxGraphemes) || maxGraphemes <= 0) return '';
  // A grapheme is never shorter than one UTF-16 code unit, so this common case
  // needs no segmentation at all.
  if (value.length <= maxGraphemes && ellipsis.length <= 1) return value;
  const clusters = splitGraphemeClusters(value);
  if (clusters.length <= maxGraphemes) return value;
  const ellipsisClusters = splitGraphemeClusters(ellipsis);
  if (ellipsisClusters.length >= maxGraphemes) {
    return ellipsisClusters.slice(0, maxGraphemes).join('');
  }
  const budget = Math.max(0, maxGraphemes - ellipsisClusters.length);
  return clusters.slice(0, budget).join('') + ellipsis;
}
