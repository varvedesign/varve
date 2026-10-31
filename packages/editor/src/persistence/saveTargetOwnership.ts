/**
 * @varve/editor — save-destination ownership.
 *
 * Two open sessions can be bound to the same file through different
 * spellings: a native path alias/hard link/symlink, two browser handles that
 * name one File System Access entry, or the same stable Varve Library id. The
 * exact-path open dedupe in `openFile` only catches identical strings, so the
 * write is the last place that can stop one document from replacing another
 * open document's file and leaving that tab looking saved over stale contents.
 *
 * The guard refuses before anything is written. Identity that cannot be
 * established is a refusal too: an unreadable OS comparison must never be
 * read as "a different file".
 *
 * A chosen Save As / Save a Copy destination that turns out to be the
 * session's OWN current file goes through the same external-change check as a
 * plain Save: the baseline for those bytes exists, and the picker must not
 * become a way around it.
 */
import { contentHash, type Platform, type SaveTarget } from '@varve/platform';
import type { SaveIssue, SessionFileMeta } from '../context/types';
import { saveTargetFromSession } from './saveTypes';

/** The slice of Platform identity inspection this module needs. */
export type SaveDestinationPlatform = Pick<
  Platform,
  'sameNativeFile' | 'sameWebFileHandle' | 'readDocumentText'
>;

/** A session row: file metadata plus the tab id the guard skips. */
export interface SaveDestinationSession extends SessionFileMeta {
  id: string;
}

export const DESTINATION_IN_USE_ISSUE: Omit<SaveIssue, 'category'> & {
  category: 'destination-in-use';
} = {
  category: 'destination-in-use',
  message:
    'This file is already open in another document. Nothing was written — save to a different location, or close the other document first.',
};

const IDENTITY_UNAVAILABLE_ISSUE: SaveIssue = {
  category: 'filesystem-unavailable',
  message:
    'Varve could not confirm whether another open document uses this location, so the save was refused to protect it. Choose a different location or try again.',
};

/** Targets that can persist bytes, and so can collide with another session. */
function hasPersistentIdentity(target: SaveTarget): boolean {
  return (
    target.kind === 'native-file' ||
    target.kind === 'web-file-handle' ||
    target.kind === 'app-storage'
  );
}

/**
 * True when the two targets resolve to one destination.
 *
 * Different destination kinds cannot name the same location in a single
 * runtime (desktop sessions only hold native paths, browser sessions only
 * hold handles or the library), so a mixed pair is different by construction.
 * App-storage identity is the stable library id, deliberately not a path.
 */
function targetsIdentifySameDestination(
  platform: SaveDestinationPlatform,
  target: SaveTarget,
  other: SaveTarget,
): Promise<boolean> {
  if (target.kind === 'native-file' && other.kind === 'native-file') {
    return platform.sameNativeFile(target.path, other.path);
  }
  if (target.kind === 'web-file-handle' && other.kind === 'web-file-handle') {
    return platform.sameWebFileHandle(target.handleId, other.handleId);
  }
  if (target.kind === 'app-storage' && other.kind === 'app-storage') {
    return Promise.resolve(target.fileId === other.fileId);
  }
  return Promise.resolve(false);
}

/**
 * Refuse a target another open session owns. Returns the issue the caller
 * must surface, or null when the write may proceed.
 *
 * `sessions` is read at the moment of the check — after a destination picker
 * has returned — so a tab opened while the picker was up is included.
 */
export async function rejectTargetOwnedByAnotherSession(
  platform: SaveDestinationPlatform,
  target: SaveTarget,
  sessions: readonly SaveDestinationSession[],
  activeSessionId: string,
): Promise<SaveIssue | null> {
  if (!hasPersistentIdentity(target)) return null;
  try {
    for (const session of sessions) {
      if (session.id === activeSessionId) continue;
      const other = saveTargetFromSession(session);
      if (await targetsIdentifySameDestination(platform, target, other)) {
        return DESTINATION_IN_USE_ISSUE;
      }
    }
    return null;
  } catch {
    // The identity APIs reject when they cannot answer. Treat that as "may be
    // the same file" — fail closed rather than risk replacing another tab.
    return IDENTITY_UNAVAILABLE_ISSUE;
  }
}

/**
 * Verify a newly chosen Save As / Save a Copy destination will not overwrite
 * changed bytes this session already had a baseline for. Returns the issue to
 * surface, or null when there is nothing to verify or the bytes still match.
 */
export async function verifyChosenSaveDestinationUnchanged(
  platform: SaveDestinationPlatform,
  target: SaveTarget,
  currentSession: SessionFileMeta | undefined,
): Promise<SaveIssue | null> {
  if (target.kind !== 'native-file') return null;
  const currentPath = currentSession?.filePath;
  const expectedHash = currentSession?.diskContentHash;
  if (!currentPath || !expectedHash) return null;
  let sameAsCurrent: boolean;
  try {
    sameAsCurrent = await platform.sameNativeFile(target.path, currentPath);
  } catch {
    return IDENTITY_UNAVAILABLE_ISSUE;
  }
  if (!sameAsCurrent) return null;
  const disk = await platform.readDocumentText(target.path).catch(() => null);
  if (!disk || !disk.ok) {
    if (disk?.reason === 'missing') {
      // The file this session was bound to is gone. The picker explicitly
      // chose to write there, and there are no bytes left to protect.
      return null;
    }
    return IDENTITY_UNAVAILABLE_ISSUE;
  }
  if (contentHash(disk.text) === expectedHash) return null;
  return {
    category: 'file-changed-externally',
    message:
      'The file changed on disk since it was opened. Nothing was written — save to a different location, or reopen the document before saving.',
  };
}

/**
 * Full pre-write check for a destination the user just chose (Save As,
 * Save a Copy): ownership first, then the current file's external-change
 * baseline. Returns the issue to surface, or null to write.
 */
export async function checkChosenSaveDestination(
  platform: SaveDestinationPlatform,
  target: SaveTarget,
  sessions: readonly SaveDestinationSession[],
  activeSessionId: string,
  currentSession: SessionFileMeta | undefined,
): Promise<SaveIssue | null> {
  const ownershipProblem = await rejectTargetOwnedByAnotherSession(
    platform,
    target,
    sessions,
    activeSessionId,
  );
  if (ownershipProblem) return ownershipProblem;
  return await verifyChosenSaveDestinationUnchanged(platform, target, currentSession);
}
