/**
 * Selective per-participant undo (ADR-0019 Model B, ADR-0200).
 *
 * In a shared session, undo is a compensating forward operation computed at
 * undo time against the CURRENT document — never a historical snapshot
 * restore (which would erase collaborators' interleaved edits) and never a
 * shared undo stack. This is the Figma/Excalidraw-7348 model: undo reverses
 * only the initiating participant's own recorded changes, superseded values
 * are skipped, and the compensation itself is an ordinary capture payload
 * replicated to the room like any other edit.
 *
 * Guarantees (see selectiveUndo.test.ts):
 * - A moves an object, B recolors it, A undoes: B's color survives.
 * - A changes a property, B later changes the same property, A undoes:
 *   B's later intent is kept (skip with reason), not blindly replaced.
 * - A creates an object, B edits it, A undoes the creation: the object
 *   survives with B's edits (skip with reason) — collaborators' dependent
 *   contributions are preserved, and its membership arrays are never
 *   rewound behind it.
 * - A deletes an object: undo restores the full pre-delete entity from
 *   A's own step (the deleter's buffer holds the payload).
 * - Text: an undo removes/restores EXACTLY the participant's own inserted
 *   or deleted cluster sequence, located by content at transformed
 *   anchors; if that content is no longer present the step skips with an
 *   explicit reason. It can never delete someone else's words.
 *
 * Pure module: no transport, no React, no I/O.
 */

import type { CapturedChange, Document, TransactionCapturePayload } from '@varve/scene';
import { lcsIndices } from './lcs';
import { clusters, spliceBetween } from './textSplice';

/** One locally authored capture eligible for undo (newest first from the caller). */
export interface LocalCaptureStep {
  /** Persistent-history revision id (diagnostics + redo bookkeeping). */
  revisionId: string;
  /** Wire operation id that carried this step, for revert provenance. */
  clientOpId: string | null;
  capture: TransactionCapturePayload;
}

export type SkipReason =
  | 'superseded'
  | 'entity-missing'
  | 'modified-by-others'
  | 'text-overlap'
  | 'order-changed';

export interface CompensationSkip {
  changeIndex: number;
  summary: string;
  reason: SkipReason;
}

export interface StepCompensation {
  /** Ordered changes to apply as the compensation capture. */
  changes: CapturedChange[];
  skips: CompensationSkip[];
  /**
   * 'full'    — every change compensated; undoing reproduces the step's start.
   * 'partial' — some changes compensated, others skipped (callers surface why).
   * 'no-op'   — nothing was compensable (callers do not create a history step).
   */
  kind: 'full' | 'partial' | 'no-op';
}

export interface RedoStep {
  /** The original step being reapplied. */
  step: LocalCaptureStep;
  /** The compensation capture that was applied for its undo. */
  compensation: TransactionCapturePayload;
}

export function computeStepCompensation(
  current: Document,
  step: LocalCaptureStep,
): StepCompensation {
  const changes: CapturedChange[] = [];
  const skips: CompensationSkip[] = [];
  const original = step.capture.changes;
  const keptEntities = keptEntityIds(current, original);
  const overlay = new Map<string, unknown>();

  // Reverse order: a multi-change step folds onto itself (undoing a later
  // property edit precedes reading earlier steps' guards).
  for (let i = original.length - 1; i >= 0; i--) {
    const change = original[i]!;
    const skip = (reason: SkipReason) => {
      skips.push({ changeIndex: i, summary: change.summary, reason });
    };

    switch (change.changeType) {
      case 'modified':
      case 'renamed': {
        const path = change.propertyPath;
        if (!path) {
          skip('superseded');
          break;
        }
        const currentValue = readValue(overlay, current, path);
        if (deepEqualsStable(currentValue, change.after)) {
          const revert = revertChange(change, change.after, change.before);
          changes.push(revert);
          writeOverlay(overlay, revert);
        } else if (currentValue === undefined) {
          skip('entity-missing');
        } else {
          skip('superseded');
        }
        break;
      }

      case 'added': {
        // My creation: remove it only when it still matches what I created.
        const path = change.propertyPath;
        if (!path || !change.after || typeof change.after !== 'object') {
          skip('superseded');
          break;
        }
        const live = readEntity(overlay, current, path, change.entityId);
        if (live === undefined) {
          skip('entity-missing');
          break;
        }
        if (deepEqualsStable(live, change.after)) {
          const revert: CapturedChange = {
            changeType: 'removed',
            entityId: change.entityId,
            entityType: change.entityType,
            propertyPath: path,
            before: live,
            summary: `Undo create: ${change.summary}`,
          };
          changes.push(revert);
          removeOverlayEntity(overlay, path, change.entityId);
        } else {
          skip('modified-by-others');
        }
        break;
      }

      case 'removed': {
        // My deletion: restore the full pre-delete entity from my own step.
        const path = change.propertyPath;
        if (!path || change.before === undefined) {
          skip('superseded');
          break;
        }
        const live = readEntity(overlay, current, path, change.entityId);
        if (live !== undefined) {
          skip('superseded');
          break;
        }
        const revert: CapturedChange = {
          changeType: 'added',
          entityId: change.entityId,
          entityType: change.entityType,
          propertyPath: path,
          after: change.before,
          summary: `Undo delete: ${change.summary}`,
        };
        changes.push(revert);
        writeOverlayEntity(overlay, path, change.entityId, change.before);
        break;
      }

      case 'reordered': {
        const path = change.propertyPath;
        if (!path) {
          skip('superseded');
          break;
        }
        // Entities this step kept alive stay in their containers: rewinding
        // the order would orphan them (paint order without a node).
        if (arrayMentionsKeptEntity(change.after, keptEntities)) {
          skip('order-changed');
          break;
        }
        const currentArray = readValue(overlay, current, path);
        if (deepEqualsStable(currentArray, change.after)) {
          const revert = revertChange(change, change.after, change.before);
          changes.push(revert);
          writeOverlay(overlay, revert);
        } else {
          skip('order-changed');
        }
        break;
      }

      case 'text': {
        compensateText(change, current, overlay, changes, skip);
        break;
      }
    }
  }

  const kind = changes.length === 0 ? 'no-op' : skips.length === 0 ? 'full' : 'partial';
  return { changes, skips, kind };
}

/**
 * Redo: reapply the original step where the compensation still holds.
 * Properties someone else changed since the undo are skipped, never
 * blindly replaced (the mirror of the undo rule).
 */
export function computeRedoCompensation(current: Document, redo: RedoStep): StepCompensation {
  const overlay = new Map<string, unknown>();
  const changes: CapturedChange[] = [];
  const skips: CompensationSkip[] = [];
  const original = redo.step.capture.changes;

  for (let i = 0; i < original.length; i++) {
    const change = original[i]!;
    const skip = (reason: SkipReason) => {
      skips.push({ changeIndex: i, summary: change.summary, reason });
    };

    switch (change.changeType) {
      case 'modified':
      case 'renamed':
      case 'reordered': {
        const path = change.propertyPath;
        if (!path) {
          skip('superseded');
          break;
        }
        const currentValue = readValue(overlay, current, path);
        const compensatedValue = compensationValueAt(redo.compensation, path);
        const expected = compensatedValue !== undefined ? compensatedValue : change.before;
        if (deepEqualsStable(currentValue, expected)) {
          const reapply = revertChange(change, change.before, change.after);
          changes.push(reapply);
          writeOverlay(overlay, reapply);
        } else if (currentValue === undefined) {
          skip('entity-missing');
        } else {
          skip('superseded');
        }
        break;
      }
      case 'added': {
        // Re-creating: only when the entity is still absent.
        const path = change.propertyPath;
        if (!path) {
          skip('superseded');
          break;
        }
        const live = readEntity(overlay, current, path, change.entityId);
        if (live !== undefined) {
          skip('superseded');
          break;
        }
        const reapply: CapturedChange = {
          changeType: 'added',
          entityId: change.entityId,
          entityType: change.entityType,
          propertyPath: path,
          after: change.after,
          summary: `Redo create: ${change.summary}`,
        };
        changes.push(reapply);
        writeOverlayEntity(overlay, path, change.entityId, change.after);
        break;
      }
      case 'removed': {
        // Re-deleting: only when the entity still matches the restored value.
        const path = change.propertyPath;
        if (!path || change.before === undefined) {
          skip('superseded');
          break;
        }
        const live = readEntity(overlay, current, path, change.entityId);
        if (live === undefined) {
          skip('entity-missing');
          break;
        }
        if (deepEqualsStable(live, change.before)) {
          const reapply: CapturedChange = {
            changeType: 'removed',
            entityId: change.entityId,
            entityType: change.entityType,
            propertyPath: path,
            before: live,
            summary: `Redo delete: ${change.summary}`,
          };
          changes.push(reapply);
          removeOverlayEntity(overlay, path, change.entityId);
        } else {
          skip('modified-by-others');
        }
        break;
      }
      case 'text': {
        redoText(change, current, redo, overlay, changes, skip);
        break;
      }
    }
  }

  const kind = changes.length === 0 ? 'no-op' : skips.length === 0 ? 'full' : 'partial';
  return { changes, skips, kind };
}

// ── Text compensation ─────────────────────────────────────────────────────────

interface Ranges {
  baseStart: number;
  baseEnd: number;
  targetStart: number;
  targetEnd: number;
}

function rangesOf(change: CapturedChange): Ranges {
  return change.textRanges ?? { baseStart: 0, baseEnd: 0, targetStart: 0, targetEnd: 0 };
}

/**
 * Undo one captured text change against the current text.
 *
 * The undo targets EXACTLY the cluster sequence the step inserted (or
 * restores EXACTLY the sequence it deleted). Its location in the current
 * text is computed by mapping the step's base positions through the LCS of
 * the base and current cluster sequences — precise even when a remote edit
 * brackets the target — and a candidate only wins when the content matches
 * exactly. When nothing matches, the step skips: the participant's words
 * are already gone (or fully rewritten), so there is nothing of theirs
 * left to reverse.
 */
function compensateText(
  change: CapturedChange,
  current: Document,
  overlay: Map<string, unknown>,
  out: CapturedChange[],
  skip: (reason: SkipReason) => void,
): void {
  const path = change.propertyPath;
  if (!path || typeof change.before !== 'string' || typeof change.after !== 'string') {
    skip('superseded');
    return;
  }
  const currentText = readValue(overlay, current, path);
  if (typeof currentText !== 'string') {
    skip('entity-missing');
    return;
  }

  // Fast path: nobody touched the text since the step — exact inverse.
  if (currentText === change.after) {
    const ranges = rangesOf(change);
    pushTextChange(out, overlay, path, change, currentText, change.before, {
      baseStart: ranges.targetStart,
      baseEnd: ranges.targetEnd,
      targetStart: ranges.baseStart,
      targetEnd: ranges.baseEnd,
    });
    return;
  }

  const ranges = rangesOf(change);
  const inserted = clusters(change.after).slice(ranges.targetStart, ranges.targetEnd);
  const deleted = clusters(change.before).slice(ranges.baseStart, ranges.baseEnd);
  const currentClusters = clusters(currentText);
  const baseClusters = clusters(change.before);
  const map = basePositionMap(baseClusters, currentClusters);

  if (inserted.length > 0) {
    // My inserted content lives in the LCS gap between the current
    // positions bracketing my base span. Other participants' inserts can
    // share that gap, so locate my exact cluster sequence within it (first
    // match; identical content is interchangeable in the pathological
    // duplicate case).
    const gapStart = ranges.baseStart > 0 ? map(ranges.baseStart - 1) + 1 : 0;
    const gapEnd =
      ranges.baseStart < baseClusters.length ? map(ranges.baseStart) : currentClusters.length;
    for (let start = gapStart; start + inserted.length <= gapEnd; start++) {
      if (matchesAt(currentClusters, start, inserted)) {
        pushTextSplice(out, overlay, path, change, currentText, inserted, [], start);
        return;
      }
    }
    skip('text-overlap');
    return;
  }

  if (deleted.length > 0) {
    // Restore exactly where the base position maps to, when absent there.
    const anchor = map(ranges.baseStart);
    if (
      anchor >= 0 &&
      anchor + deleted.length <= currentClusters.length &&
      !matchesAt(currentClusters, anchor, deleted)
    ) {
      pushTextSplice(out, overlay, path, change, currentText, [], deleted, anchor);
      return;
    }
    skip('text-overlap');
    return;
  }

  skip('superseded');
}

/**
 * Map a base cluster position into current-text coordinates through the
 * LCS of the two cluster sequences: the current position of the last
 * matched base cluster at or before `p`, plus the residual offset.
 */
function basePositionMap(baseClusters: string[], currentClusters: string[]): (p: number) => number {
  const pairs = lcsIndices(baseClusters, currentClusters);
  return (p: number) => {
    let mapped = 0;
    let mappedBase = -1;
    for (const [bi, ci] of pairs) {
      if (bi > p) break;
      mapped = ci;
      mappedBase = bi;
    }
    if (mappedBase < 0) return p;
    return mapped + (p - mappedBase);
  };
}

/** Redo one captured text change: reapply the forward splice where it still holds. */
function redoText(
  change: CapturedChange,
  current: Document,
  redo: RedoStep,
  overlay: Map<string, unknown>,
  out: CapturedChange[],
  skip: (reason: SkipReason) => void,
): void {
  const path = change.propertyPath;
  if (!path || typeof change.before !== 'string' || typeof change.after !== 'string') {
    skip('superseded');
    return;
  }
  const currentText = readValue(overlay, current, path);
  if (typeof currentText !== 'string') {
    skip('entity-missing');
    return;
  }
  const compensatedText = compensationValueAt(redo.compensation, path);
  const base = typeof compensatedText === 'string' ? compensatedText : change.before;

  if (currentText === base) {
    pushTextChange(out, overlay, path, change, currentText, change.after, rangesOf(change));
    return;
  }
  // Text moved on after the undo: reapply my forward splice by content.
  const inserted = clusters(change.after).slice(
    rangesOf(change).targetStart,
    rangesOf(change).targetEnd,
  );
  const divergence = spliceBetween(base, currentText);
  if (!divergence) {
    pushTextChange(out, overlay, path, change, currentText, change.after, rangesOf(change));
    return;
  }
  const delta = divergence.replacement.length - (divergence.end - divergence.start);
  const anchor =
    rangesOf(change).baseStart + (divergence.start <= rangesOf(change).baseStart ? delta : 0);
  const currentClusters = clusters(currentText);
  if (
    anchor >= 0 &&
    anchor + inserted.length <= currentClusters.length + 1 &&
    // The span being replaced must still hold the base content (or the
    // compensated text), otherwise the span was rewritten and redo skips.
    spliceAppliable(currentClusters, anchor, rangesOf(change), inserted.length)
  ) {
    pushTextSplice(
      out,
      overlay,
      path,
      change,
      currentText,
      inserted,
      [],
      anchor,
      rangesOf(change).baseEnd - rangesOf(change).baseStart,
    );
    return;
  }
  skip('text-overlap');
}

function spliceAppliable(
  currentClusters: string[],
  anchor: number,
  ranges: Ranges,
  insertedLength: number,
): boolean {
  const spanLength = ranges.baseEnd - ranges.baseStart;
  if (spanLength === 0) return true;
  return (
    anchor + spanLength <= currentClusters.length ||
    anchor + insertedLength <= currentClusters.length
  );
}

function matchesAt(haystack: string[], at: number, needle: string[]): boolean {
  for (let i = 0; i < needle.length; i++) {
    if (haystack[at + i] !== needle[i]) return false;
  }
  return true;
}

function pushTextChange(
  out: CapturedChange[],
  overlay: Map<string, unknown>,
  path: string,
  original: CapturedChange,
  beforeText: string,
  afterText: string,
  ranges: Ranges,
): void {
  const revert: CapturedChange = {
    changeType: 'text',
    entityId: original.entityId,
    entityType: original.entityType,
    propertyPath: path,
    before: beforeText,
    after: afterText,
    textRanges: ranges,
    summary: undoLabel(original),
  };
  out.push(revert);
  overlay.set(path, afterText);
}

function pushTextSplice(
  out: CapturedChange[],
  overlay: Map<string, unknown>,
  path: string,
  original: CapturedChange,
  beforeText: string,
  removed: string[],
  inserted: string[],
  anchor: number,
  removeLength?: number,
): void {
  const length = removeLength ?? removed.length;
  const afterText = [
    ...clusters(beforeText).slice(0, anchor),
    ...inserted,
    ...clusters(beforeText).slice(anchor + length),
  ].join('');
  pushTextChange(out, overlay, path, original, beforeText, afterText, {
    baseStart: anchor,
    baseEnd: anchor + length,
    targetStart: anchor,
    targetEnd: anchor + inserted.length,
  });
}

function undoLabel(original: CapturedChange): string {
  return `Undo ${original.summary}`;
}

// ── Guards and helpers ────────────────────────────────────────────────────────

/**
 * Entities whose add-removal or delete-restore will be skipped (they stay
 * in the document). Computed up front so container order reverts can guard.
 */
function keptEntityIds(current: Document, changes: CapturedChange[]): Set<string> {
  const kept = new Set<string>();
  for (const change of changes) {
    if (change.changeType !== 'added' && change.changeType !== 'removed') continue;
    const path = change.propertyPath;
    if (!path) continue;
    if (change.changeType === 'added') {
      if (!change.after || typeof change.after !== 'object') continue;
      const live = readEntity(new Map(), current, path, change.entityId);
      if (live === undefined || !deepEqualsStable(live, change.after)) kept.add(change.entityId);
    } else if (change.before !== undefined) {
      const live = readEntity(new Map(), current, path, change.entityId);
      if (live !== undefined) kept.add(change.entityId);
    }
  }
  return kept;
}

function arrayMentionsKeptEntity(array: unknown, kept: Set<string>): boolean {
  if (!Array.isArray(array)) return false;
  return array.some((item) => {
    if (typeof item === 'string') return kept.has(item);
    if (item && typeof item === 'object') {
      const id = (item as Record<string, unknown>).id;
      return typeof id === 'string' && kept.has(id);
    }
    return false;
  });
}

function revertChange(change: CapturedChange, from: unknown, to: unknown): CapturedChange {
  return {
    changeType: change.changeType,
    entityId: change.entityId,
    entityType: change.entityType,
    propertyPath: change.propertyPath,
    before: from,
    after: to,
    summary: `Undo ${change.summary}`,
  };
}

/** Read a value at a document-relative dotted path through the overlay. */
function readValue(overlay: Map<string, unknown>, doc: Document, path: string): unknown {
  if (overlay.has(path)) return overlay.get(path);
  return readFromDocument(doc, path);
}

/** Read one map-backed entity through the overlay. */
function readEntity(
  overlay: Map<string, unknown>,
  doc: Document,
  containerPath: string,
  entityId: string,
): unknown {
  const key = `${containerPath}#${entityId}`;
  if (overlay.has(key)) return overlay.get(key);
  const container = readFromDocument(doc, containerPath);
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    const value = (container as Record<string, unknown>)[entityId];
    return value === undefined ? undefined : value;
  }
  return undefined;
}

function writeOverlay(overlay: Map<string, unknown>, change: CapturedChange): void {
  if (change.propertyPath) overlay.set(change.propertyPath, change.after);
}

function writeOverlayEntity(
  overlay: Map<string, unknown>,
  containerPath: string,
  entityId: string,
  value: unknown,
): void {
  overlay.set(`${containerPath}#${entityId}`, value);
}

function removeOverlayEntity(
  overlay: Map<string, unknown>,
  containerPath: string,
  entityId: string,
): void {
  overlay.set(`${containerPath}#${entityId}`, undefined);
}

/**
 * Read a dotted path with captureOps traversal semantics: numeric segments
 * index arrays, id segments match array entries by `id`, everything else
 * descends plain records. Returns undefined for any unreachable path.
 */
export function readFromDocument(doc: Document, path: string): unknown {
  let current: unknown = doc;
  for (const segment of path.split('.')) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isInteger(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      const found = (current as Array<Record<string, unknown>>).find(
        (item) =>
          item && typeof item === 'object' && (item as Record<string, unknown>).id === segment,
      );
      if (found === undefined) return undefined;
      current = found;
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * The value a compensation capture left at a path (for redo guards).
 * Scans the compensation's changes in reverse; `removed` entities read as
 * absent, `added`/`modified`/`reordered` as their after value.
 */
function compensationValueAt(capture: TransactionCapturePayload, path: string): unknown {
  for (let i = capture.changes.length - 1; i >= 0; i--) {
    const change = capture.changes[i]!;
    if (change.propertyPath !== path) continue;
    if (change.changeType === 'removed') return undefined;
    return change.after;
  }
  return undefined;
}

/** Reference-equality first, then stable structural equality. */
export function deepEqualsStable(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
