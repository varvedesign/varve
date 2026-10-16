/**
 * Grapheme-cluster text splice merge (ADR-0034 ranges, room-order policy).
 *
 * Concurrent edits to one node's text arrive as contiguous grapheme-cluster
 * splices computed against the sender's base text. This module merges an
 * incoming splice into locally diverged text. Every rule derives from one
 * convention — simulate the room applying both operations in sequence
 * order; a later insert whose point falls inside an earlier
 * replace/delete span clamps to just after the earlier replacement — and
 * both mirror sites of each case compute identical content:
 *
 * - Disjoint splices merge: both participants' edits survive.
 * - Same-point inserts: the earlier room sequence lands first (a locally
 *   pending edit counts as later — it will be sequenced above anything
 *   already received).
 * - Replace/delete spans that overlap: the later room sequence wins.
 * - An insert strictly inside an earlier replace/delete span lands right
 *   after the replacement content on both sites.
 * - An earlier replace/delete touching or containing a later local insert
 *   lands before the insert (the insert is sequenced later, so it
 *   survives on top of the earlier replacement).
 * - A later replace/delete strictly containing an earlier local insert
 *   drops the insert — last-writer-wins for the contested span. The
 *   losing local edit stays in the local participant's undo history as a
 *   recoverable compensating step; it is not silently destroyed.
 *
 * Positions are in grapheme-cluster space (logical order), so emoji
 * sequences, combining marks, and bidi text transform consistently
 * regardless of visual direction. Convergence under randomized op
 * schedules is property-tested in textSplice.test.ts.
 */

import { graphemeClusters } from '@varve/scene';

export interface TextSplice {
  /** Grapheme-cluster range in the base text ([start, end)). */
  start: number;
  end: number;
  /** Replacement cluster array for the range. */
  replacement: string[];
}

/** Split text into grapheme clusters. */
export function clusters(text: string): string[] {
  return graphemeClusters(text);
}

/**
 * Compute the single trimmed splice that turns `base` into `current`
 * (same trimming rule as the history differ: equal prefix/suffix clusters
 * are never included). Returns null when the texts are identical.
 */
export function spliceBetween(base: string, current: string): TextSplice | null {
  if (base === current) return null;
  const baseClusters = clusters(base);
  const currentClusters = clusters(current);
  let start = 0;
  const limit = Math.min(baseClusters.length, currentClusters.length);
  while (start < limit && baseClusters[start] === currentClusters[start]) start++;
  let baseEnd = baseClusters.length;
  let currentEnd = currentClusters.length;
  while (
    baseEnd > start &&
    currentEnd > start &&
    baseClusters[baseEnd - 1] === currentClusters[currentEnd - 1]
  ) {
    baseEnd--;
    currentEnd--;
  }
  return {
    start,
    end: baseEnd,
    replacement: currentClusters.slice(start, currentEnd),
  };
}

export function applySplice(text: string, splice: TextSplice): string {
  const parts = clusters(text);
  const head = parts.slice(0, splice.start);
  const tail = parts.slice(splice.end);
  return [...head, ...splice.replacement, ...tail].join('');
}

export interface MergeIncomingOptions {
  /**
   * True when the incoming op's room sequence is greater than the sequence
   * of the local divergence (a locally pending, unacked edit counts as
   * later than every received op).
   */
  incomingIsLater: boolean;
}

export type MergeOutcome = 'merged' | 'incoming-wins' | 'incoming-loses';

/**
 * Merge an incoming splice (computed against `base`) into `current` text
 * that has diverged from `base`. Deterministic in the room order: the same
 * (base, current, incoming, incomingIsLater) tuple always yields the same
 * result on every client.
 *
 * - `merged`          — apply `text`.
 * - `incoming-wins`   — apply `text` (the incoming op overwrites the
 *                       contested span); the caller surfaces the supersession.
 * - `incoming-loses`  — keep `current` unchanged; the local (later) edit
 *                       wins and will reach the room when acked.
 */
export function mergeIncomingSplice(
  base: string,
  current: string,
  incoming: TextSplice,
  options: MergeIncomingOptions,
): { text: string; mode: MergeOutcome } {
  if (current === base) {
    return { text: applySplice(current, incoming), mode: 'merged' };
  }
  const local = spliceBetween(base, current);
  if (!local) {
    return { text: applySplice(current, incoming), mode: 'merged' };
  }
  const currentClusters = clusters(current);
  const incomingReplaces = incoming.start !== incoming.end;
  const localReplaces = local.start !== local.end;
  const spansOverlap = incoming.start < local.end && local.start < incoming.end;

  // Two non-collapsed spans that overlap: the later room sequence wins the
  // contested region.
  if (spansOverlap && incomingReplaces && localReplaces) {
    return options.incomingIsLater
      ? { text: applySplice(base, incoming), mode: 'incoming-wins' }
      : { text: current, mode: 'incoming-loses' };
  }

  // Incoming insert strictly inside the local rewritten span.
  if (
    !incomingReplaces &&
    localReplaces &&
    local.start < incoming.start &&
    incoming.start < local.end
  ) {
    if (!options.incomingIsLater) {
      // The local rewrite is sequenced LATER than the incoming insert, so
      // the rewrite already removed the inserted content: keep current.
      return { text: current, mode: 'incoming-loses' };
    }
    // The local rewrite is earlier: the insert clamps to just after the
    // replacement content on every site.
    const at = local.start + local.replacement.length;
    return { text: insertAt(currentClusters, at, incoming.replacement), mode: 'merged' };
  }

  // Incoming replace/delete whose span touches or contains the local
  // insert point. Touching means the insert sits at the span's start or
  // end boundary; both are the insert-at-a-rewritten-boundary case.
  if (
    incomingReplaces &&
    !localReplaces &&
    incoming.start <= local.start &&
    local.start <= incoming.end
  ) {
    const strictlyInside = incoming.start < local.start && local.start < incoming.end;
    if (strictlyInside && options.incomingIsLater) {
      // The incoming rewrite is sequenced later: it removes the span
      // including the locally inserted content (last-writer-wins).
      return { text: applySplice(base, incoming), mode: 'incoming-wins' };
    }
    // The incoming rewrite is sequenced before the local insert (or the
    // insert touches the boundary): the insert survives next to the
    // replacement content, ordered by the sequence rule.
    const text = spliceReplacingBaseSpan(currentClusters, local, incoming, options);
    return { text, mode: 'merged' };
  }

  // Disjoint spans, same-point inserts, and inserts at rewritten span
  // boundaries: deterministic position shift.
  return {
    text: shiftAndApply(currentClusters, local, incoming, options),
    mode: 'merged',
  };
}

function insertAt(currentClusters: string[], at: number, replacement: string[]): string {
  return [...currentClusters.slice(0, at), ...replacement, ...currentClusters.slice(at)].join('');
}

/**
 * Apply an incoming replace/delete whose base span touches or contains the
 * local insert point while the insert survives on top: remove exactly the
 * base-span content from the current text (keeping the local insertion) and
 * order the replacement content against the insert by room sequence. An
 * insert at the span's start boundary lands before a LATER replacement
 * (the replace shifts past it) and after an EARLIER one (the clamp rule).
 */
function spliceReplacingBaseSpan(
  currentClusters: string[],
  local: TextSplice,
  incoming: TextSplice,
  options: MergeIncomingOptions,
): string {
  const localDelta = local.replacement.length;
  const tailStart = Math.min(incoming.end + localDelta, currentClusters.length);
  const tail = currentClusters.slice(tailStart);
  const insertFirst = local.start === incoming.start && options.incomingIsLater;
  const head = currentClusters.slice(0, insertFirst ? local.start : incoming.start);
  const replacement = insertFirst
    ? [...local.replacement, ...incoming.replacement]
    : [...incoming.replacement, ...local.replacement];
  return [...head, ...replacement, ...tail].join('');
}

/**
 * Apply the incoming splice to the current clusters with positions mapped
 * through the local divergence. Same-point inserts: the earlier room
 * sequence lands first, the later one after it. An insert at the boundary
 * of a local replace/delete span lands before its content when earlier,
 * after it when later (the clamp rule).
 */
function shiftAndApply(
  currentClusters: string[],
  local: TextSplice,
  incoming: TextSplice,
  options: MergeIncomingOptions,
): string {
  const localDelta = local.replacement.length - (local.end - local.start);
  const localIsInsert = local.start === local.end;
  let start = incoming.start;
  let end = incoming.end;

  if (incoming.start > local.start) {
    // Strictly after the local span: shifted by its length change.
    start += localDelta;
    end += localDelta;
  } else if (incoming.start === local.start && options.incomingIsLater) {
    if (localIsInsert) {
      // Same-point insert: the later sequence lands after the earlier
      // one's content.
      start += localDelta;
      end += localDelta;
    } else {
      // Insert at the start boundary of a local replace/delete: the clamp
      // rule lands it after the replacement content (which is the
      // deletion point when the replacement is empty).
      start = local.start + local.replacement.length;
      end = start;
    }
  }
  // incoming.start < local.start: unaffected (strictly before the local edit).
  const shifted: TextSplice = { start, end, replacement: incoming.replacement };
  return applySplice(currentClusters.join(''), shifted);
}
