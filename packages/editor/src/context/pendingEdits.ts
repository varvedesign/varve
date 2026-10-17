/**
 * Pending editor drafts — the buffered-work contract.
 *
 * Evidence: storytold/pdfcraft #811 ("save and close ignore typing in an open
 * paragraph") and #166 ("Save omits AcroForm text while the field remains
 * focused"). Both describe the same transferable defect: an editing surface
 * buffers typed input so it does not repaint the document per keystroke, and
 * then nothing tells the persistence or termination paths that the buffer
 * exists. A save, close, or quit taken inside the buffering window writes — or
 * keeps — a document that is missing text the user can see, and the document
 * may still report itself clean, so the loss is silent.
 *
 * The buffering is not the defect. The same tracker's #2616 ("every letter
 * added freezes the program") is the failure mode without it, and Varve's own
 * `TextEditOverlay` documents the coalescing window for the same reason. The
 * defect is the missing flush point.
 *
 * Contract: a surface that holds a model write registers a source while the
 * write can be outstanding. Every consumer that OBSERVES or PERSISTS the model
 * on the user's behalf — the save engine, the termination coordinator, unload
 * recovery — drains those sources first, so the revision it captures is the
 * revision the user is looking at.
 *
 * The drain is synchronous by design. `stateRef` is the editor's
 * async-authoritative view of state and React advances it when the update
 * commits, so a consumer that runs later in the same task (a save intent
 * queued from a keyboard shortcut, a quit resolution continuing after an
 * `await`) would otherwise read the pre-flush revision — which is exactly the
 * defect this module exists to close. `flushSync` here is the same drain
 * `TextEditOverlay.prepareFormatting` already performs before a formatting
 * event snapshots a new edit.
 */

import { flushSync } from 'react-dom';

export interface PendingEditSource {
  /** Stable identity, so a re-registering surface replaces its own entry. */
  id: string;
  /** True while this source holds a model write it has not applied yet. */
  hasPending: () => boolean;
  /**
   * Apply the buffered write. Owned by the registering surface: it must use
   * that surface's own write path so history, transaction, and naming
   * semantics are unchanged. Called only when `hasPending()` is true.
   */
  flush: () => void;
}

const sources = new Map<string, PendingEditSource>();

/**
 * Register a buffering surface. Returns an unsubscribe function; call it when
 * the surface unmounts or no longer buffers (a stale entry would make every
 * observation point pay a flush for work that no longer exists).
 */
export function registerPendingEditSource(source: PendingEditSource): () => void {
  const previous = sources.get(source.id);
  sources.set(source.id, source);
  return () => {
    // Only remove the entry this registration installed. A remount can
    // register before the old cleanup runs, and clearing the newer source
    // would silently re-open the loss window this module closes.
    if (sources.get(source.id) === source) sources.delete(source.id);
    else if (previous && sources.get(source.id) === previous) sources.set(source.id, previous);
  };
}

/** Registered source ids, for diagnostics and tests. */
export function pendingEditSourceIds(): string[] {
  return [...sources.keys()];
}

/** True when any registered surface is holding an unapplied model write. */
export function hasPendingEdits(): boolean {
  for (const source of sources.values()) {
    if (source.hasPending()) return true;
  }
  return false;
}

/**
 * Drain every pending source and commit the resulting React update before
 * returning, so a later reader of the editor's authoritative state sees the
 * flushed model. Returns how many sources actually had work.
 *
 * A source that throws must not stop the drain or the caller: this runs in the
 * save and quit paths, where writing the model we do have is strictly better
 * than failing the save. The failure is surfaced in development only, because
 * there is no user-facing surface that could act on it from here.
 */
export function flushPendingEdits(): number {
  const targets = [...sources.values()].filter((source) => source.hasPending());
  if (targets.length === 0) return 0;
  flushSync(() => {
    for (const source of targets) {
      // Re-check inside the drain: an earlier source's flush can settle a
      // later one (both read the same document), and flushing an already
      // settled source would be a redundant model write.
      if (!source.hasPending()) continue;
      try {
        source.flush();
      } catch (error) {
        process.env.NODE_ENV !== 'production' &&
          console.warn(
            `[pending-edits] ${source.id} failed to flush before an observation point`,
            error,
          );
      }
    }
  });
  return targets.length;
}

/** Test-only: drop every registration. */
export function resetPendingEditSources(): void {
  sources.clear();
}
