/**
 * Varve Library saves — the one place where the library call is the write.
 *
 * For filesystem and browser-handle targets the Home mirror is *secondary*:
 * the bytes are already on disk, so a failed index/thumbnail update must never
 * flip a successful save to failed (`mirror()` in `usePersistence`). The same
 * call for an `app-storage` target is the document's only copy. Treating it as
 * secondary marked the document clean after a failed write, deleted its
 * recovery points, and let a later close/quit discard work that was never
 * stored — the failure mode reported as vectorcraft#1693 / #1685, where a
 * save whose write could not be confirmed still reported success.
 *
 * This module keeps that ordering explicit and testable: confirm the write,
 * then commit. A commit callback that has not run is the only guarantee that
 * "clean" means "bytes exist somewhere".
 */
import type { SaveIssue } from '../context/types';

/** Shown when the library write itself fails. Names the consequence: the
 *  document is still unsaved, and Save As remains a way out. */
export const LIBRARY_SAVE_FAILURE_MESSAGE =
  'The Varve Library could not store this document. Your work is still unsaved — use Save As to keep a copy, then try again.';

/** Map a thrown storage error to the most specific save category we can name.
 *  Browsers report quota exhaustion as a DOMException; everything else is an
 *  unknown I/O failure rather than a fabricated reason. */
export function librarySaveIssue(error: unknown): SaveIssue {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return {
      category: 'quota-exceeded',
      message:
        'The Varve Library is out of space for this document. Free space or use Save As to store it elsewhere — your work is still unsaved.',
    };
  }
  return { category: 'unknown-io', message: LIBRARY_SAVE_FAILURE_MESSAGE };
}

export interface LibrarySaveDeps {
  /** The authoritative library write. Must reject when nothing was stored. */
  write: () => Promise<void>;
  /** Runs only after the write is confirmed: clean marker, recovery cleanup,
   *  last-saved timestamp. Never called when `write` rejects. */
  commit: () => void | Promise<void>;
}

/**
 * Write a document to the library and commit the save only on success.
 *
 * Returns `null` when the document is genuinely stored, or the `SaveIssue`
 * the caller must surface. The commit callback not running is what keeps
 * `dirty` true, the recovery point alive, and a close request from being
 * satisfied.
 */
export async function commitLibrarySave(deps: LibrarySaveDeps): Promise<SaveIssue | null> {
  try {
    await deps.write();
  } catch (error) {
    return librarySaveIssue(error);
  }
  await deps.commit();
  return null;
}
