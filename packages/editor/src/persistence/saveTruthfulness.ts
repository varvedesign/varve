/**
 * @varve/editor — what a save is allowed to claim.
 *
 * Evidence: storytold/designcraft #708 ("Web Save clears dirty state even when
 * download initiation fails", High severity) and #1050 / #1031-2, where
 * `format::save` never read its bytes back, wrote a document the app could no
 * longer open, reported success and deleted the recovery copy.
 *
 * Two rules follow, and this module is their single home:
 *
 *  1. A save may only report a file save when the bytes landed where the app
 *     can read them back. A browser snapshot download is a hand-off to the
 *     browser, not a destination — `saveTypes.ts` already says recovery and
 *     the internal Home mirror "are NEVER destinations" and "must never be
 *     reported as Saved"; a download is the same category. It never clears
 *     dirty and is never announced as a save.
 *
 *  2. The text about to be written must load through the real codec. If it
 *     does not, the save fails loudly while the document keeps its dirty state
 *     and its recovery points, instead of writing a file that cannot reopen.
 */

import { type Document, DocumentCodec } from '@varve/scene';
import type { SaveIssue } from '../context/types';

export interface SaveSuccessDecision {
  /** Whether the session may leave the dirty state. */
  marksClean: boolean;
  /**
   * The status the save service must settle on.
   *
   * A completed save must never leave `saveState` at the transient `saving`:
   * the status bar would then claim "Saving…" forever, which is a claim in
   * itself. A hand-off settles on `idle`, which the status bar renders as
   * "Modified" while the document is dirty.
   */
  settleSaveState: 'saved' | 'idle';
}

/**
 * Whether a completed write may clear dirty state, and what the status bar
 * must settle on afterwards.
 *
 * `durable` is about the destination, not the write: a browser download that
 * the page handed off has no location to read back from, so it is not durable
 * even though nothing errored. `clean` is about time: the revision that was
 * written must still be the current one (an edit during the write leaves the
 * document dirty).
 */
export function decideSaveSuccess(input: {
  durable: boolean;
  clean: boolean;
}): SaveSuccessDecision {
  if (!input.durable) return { marksClean: false, settleSaveState: 'idle' };
  return { marksClean: input.clean, settleSaveState: 'saved' };
}

/**
 * Verify that document text can be loaded back before it is written anywhere.
 *
 * Returns `null` when the text decodes, or the issue that must fail the save.
 * Callers run this BEFORE the write, so a failure leaves the destination, the
 * dirty flag and the recovery points untouched.
 */
export function verifyEncodedDocument(json: string): SaveIssue | null {
  const decoded = DocumentCodec.decode(json);
  if (decoded.ok) return null;
  return {
    category: 'serialization-failed',
    message: `The document was not saved: the file it produced could not be read back (${decoded.error}). Nothing was written, and recovery is unchanged.`,
  };
}

type VerifiedEncode = { ok: true; json: string } | { ok: false; issue: SaveIssue };

/**
 * Encode a document for writing, or explain why it cannot be written.
 *
 * Both failure modes are reported the same way, because both mean the same
 * thing to the user: no file, nothing lost.
 *  - encoding refuses a document it cannot represent faithfully
 *    (`NonFiniteDocumentError`), and
 *  - text that does not load back through the codec is rejected before it
 *    reaches a destination.
 */
export function encodeVerifiedDocument(document: Document): VerifiedEncode {
  let json: string;
  try {
    json = DocumentCodec.encode(document);
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'unknown error';
    const detail = /[.!?]$/.test(raw) ? raw : `${raw}.`;
    return {
      ok: false,
      issue: {
        category: 'serialization-failed',
        message: `The document was not saved: ${detail} Nothing was written, and recovery is unchanged.`,
      },
    };
  }
  const issue = verifyEncodedDocument(json);
  if (issue) return { ok: false, issue };
  return { ok: true, json };
}
