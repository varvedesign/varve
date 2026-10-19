import { getFontRegistry } from '@varve/engine';
import { attachFontManifestToDocument, createFontCatalogFromRegistry } from '@varve/engine/font';
import {
  contentHash,
  displayNameFromPath,
  type Platform,
  type SaveTarget,
  stripExtension,
  upsertPreservingMeta,
} from '@varve/platform';
import { type Document, DocumentCodec, validateDocument } from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useCallback, useRef } from 'react';
import { createSaveCoordinator } from '../persistence/saveCoordinator';

export {
  createPersistenceRevision,
  getPersistenceFontCatalog,
  type PersistenceRevision,
} from '../persistence/documentRevision';

import {
  getPersistenceFontCatalog,
  serializeDocumentSnapshot as serializeDocumentSnapshotPure,
} from '../persistence/documentRevision';
import { type SaveIntent, type SaveOutcome, saveTargetFromSession } from '../persistence/saveTypes';
import type { RecoveryManager } from '../recovery';
import { persistProjectThumbnail } from '../thumbnail/thumbnailManager';
// LoadDocumentMeta lives in ./types alongside SessionMeta/SessionFileMeta:
// types.ts is the leaf of this package's type graph, and declaring it here
// would make types.ts depend back on this module (import cycle).
import type {
  EditorState,
  LoadDocumentMeta,
  SaveIssue,
  SessionFileMeta,
  SessionMeta,
} from './types';
import { getCanvasViewport } from './viewportOps';

export type { LoadDocumentMeta };

export interface PersistenceAPI {
  serializeDocument: () => string;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  saveCopy: () => Promise<boolean>;
  loadDocument: (json: string, meta?: LoadDocumentMeta) => void;
}

interface SessionUpdate extends SessionFileMeta {}

/**
 * Encode one immutable document revision for persistence.
 *
 * Keeping this pure and document-argument based lets callers capture a
 * revision cheaply and defer the comparatively expensive codec work until a
 * background persistence lane actually runs.
 */
export function serializeDocumentSnapshot(doc: Document): string {
  return serializeDocumentSnapshotPure(doc, getPersistenceFontCatalog());
}

export function usePersistence(
  state: EditorState,
  patch: (partial: Partial<EditorState>) => void,
  stateRef: React.MutableRefObject<EditorState>,
  platform: Platform | undefined,
  resetUndo: () => void,
  /** Session mechanics stay in the editor context; persistence only asks for
   *  a new tab when a caller explicitly wants one (backup "restore a copy"). */
  openInNewSession: (doc: Document, meta?: SessionFileMeta) => void,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  // The document format has no saved camera, so opening a file whose content
  // lives far from world origin needs an explicit fit-to-content fallback —
  // shares the exact same "Fit all" computation used elsewhere, passed in
  // rather than duplicated (it depends on walkNodes/nodeWorldBounds/
  // fitBoundsCamera already imported in context.tsx).
  computeFitAllCamera: (
    doc: Document,
    viewport: Viewport,
  ) => { zoom: number; pan: { x: number; y: number } } | null,
  sessionDocumentRef: React.MutableRefObject<(sessionId: string) => Document | undefined>,
): PersistenceAPI {
  const serializeDocument = useCallback(() => {
    return serializeDocumentSnapshot(stateRef.current.document);
  }, [stateRef]);

  /**
   * The one save engine. All intents funnel through here, serialized by the
   * coordinator below, so menu Save, keyboard Save, quit Save and Save As can
   * never race each other's writes.
   *
   * Revision safety: the document object is immutable — every mutation
   * produces a new reference. Capturing it before the (possibly slow) write
   * and comparing after is a cheap, exact "did anything change while saving"
   * check: revision N finishing after revision N+1 exists must NOT clear
   * dirty state.
   */
  const runSave = useCallback(
    async (intent: SaveIntent): Promise<SaveOutcome> => {
      const sessionId = stateRef.current.activeId;
      const patchSession = (partial: Partial<EditorState>) => {
        if (stateRef.current.activeId === sessionId) {
          patch(partial);
        } else if (partial.sessions) {
          patch({ sessions: partial.sessions });
        }
      };
      if (!platform) {
        patchSession({
          saveState: 'error',
          saveIssue: issue('unsupported', 'Persistence is unavailable in this mode.'),
        });
        return {
          status: 'failed',
          issue: issue('unsupported', 'Persistence is unavailable in this mode.'),
        };
      }
      const revision = stateRef.current.document;
      // Captured BEFORE the 'saving' patch below: save-copy must restore the
      // previous status, not the transient 'saving' it just set.
      const prevSaveState = stateRef.current.saveState;
      patchSession({ saveState: 'saving', saveIssue: null });
      try {
        if (intent === 'save-as') {
          return await chooseAndAdopt(
            platform,
            stateRef,
            recoveryRef,
            patchSession,
            revision,
            stateRef.current.sessions.find((sess) => sess.id === sessionId)?.name,
            sessionId,
            sessionDocumentRef,
          );
        }
        if (intent === 'save-copy') {
          const outcome = await performSaveCopy(platform, stateRef, patchSession, revision);
          if (outcome.status !== 'failed') {
            patchSession({ saveState: prevSaveState, saveIssue: null });
          }
          return outcome;
        }
        return await performSave(
          platform,
          stateRef,
          recoveryRef,
          patchSession,
          revision,
          sessionId,
          sessionDocumentRef,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        patchSession({ saveState: 'error', saveIssue: issue('unknown-io', message) });
        return { status: 'failed', issue: issue('unknown-io', message) };
      }
    },
    [platform, stateRef, recoveryRef, patch, sessionDocumentRef],
  );

  // Coordinator is created once; runSave only reads stable refs, so the
  // captured closure never goes stale.
  const coordinatorRef = useRef<ReturnType<typeof createSaveCoordinator> | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createSaveCoordinator(runSave);
  }
  const coordinator = coordinatorRef.current;

  const save = useCallback(
    () => coordinator.request('save').then((o) => o.status === 'saved'),
    [coordinator],
  );
  const saveAs = useCallback(
    () => coordinator.request('save-as').then((o) => o.status === 'saved'),
    [coordinator],
  );
  const saveCopy = useCallback(
    () => coordinator.request('save-copy').then((o) => o.status === 'saved-copy'),
    [coordinator],
  );

  const loadDocument = useCallback(
    (json: string, meta?: LoadDocumentMeta) => {
      try {
        const decoded = DocumentCodec.decode(json);
        if (!decoded.ok) throw new Error(decoded.error);
        const doc = decoded.document;
        const result = validateDocument(doc);
        if (!result.valid && typeof console !== 'undefined') {
          console.warn('[Strata] loadDocument: validation warnings:', result.errors);
        }
        const resolvedDoc = resolveFontManifest(doc);
        const name = meta?.name ?? doc.name;

        if (meta?.newSession) {
          openInNewSession(resolvedDoc, {
            name,
            filePath: meta.filePath,
            fileId: meta.fileId,
            libraryStorage: meta.libraryStorage,
            saveHandleId: meta.saveHandleId,
            saveHandleName: meta.saveHandleName,
            downloadName: meta.downloadName,
            diskContentHash: meta.diskContentHash,
          });
          return;
        }

        resetUndo();
        const active = state.sessions.find((s) => s.id === state.activeId);
        // Rebind the tab to the incoming file unless the caller is replacing
        // the content of the file the tab already holds. Never merge the two:
        // a half-inherited identity is what makes save() write the wrong file.
        const identity: SessionFileMeta = meta?.keepIdentity
          ? {
              filePath: active?.filePath,
              fileId: active?.fileId,
              libraryStorage: active?.libraryStorage,
              saveHandleId: active?.saveHandleId,
              saveHandleName: active?.saveHandleName,
            }
          : {
              filePath: meta?.filePath,
              fileId: meta?.fileId,
              libraryStorage: meta?.libraryStorage,
              saveHandleId: meta?.saveHandleId,
              saveHandleName: meta?.saveHandleName,
              downloadName: meta?.downloadName,
              diskContentHash: meta?.diskContentHash,
            };
        const sessions = state.sessions.map((s) =>
          s.id === state.activeId ? { ...s, ...identity, name, dirty: false } : s,
        );
        const cam = computeFitAllCamera(resolvedDoc, getCanvasViewport());
        patch({
          document: resolvedDoc,
          selection: [],
          sessions,
          dirty: false,
          ...(cam ? { zoom: cam.zoom, pan: cam.pan } : {}),
        });
      } catch {
        // invalid JSON — ignore silently
      }
    },
    [patch, resetUndo, state.sessions, state.activeId, computeFitAllCamera, openInNewSession],
  );

  return { serializeDocument, save, saveAs, saveCopy, loadDocument };
}

// ─── Save engines ────────────────────────────────────────────────────────────

/** Write to the session's CURRENT destination (or choose one on first save). */
async function performSave(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
  sessionId: string,
  sessionDocumentRef: React.MutableRefObject<(sessionId: string) => Document | undefined>,
): Promise<SaveOutcome> {
  const s = stateRef.current;
  const meta = s.sessions.find((sess) => sess.id === sessionId);
  if (!meta) {
    const e = issue('destination-missing', 'No active document to save.');
    patch({ saveState: 'error', saveIssue: e });
    return { status: 'failed', issue: e };
  }
  const target = saveTargetFromSession(meta);
  const json = DocumentCodec.encode(revision);

  // First save: the user picks a location. Never silently fall into
  // internal storage — recovery may keep running, but the UI may only say
  // "Saved" once the user chose a real destination and the write succeeded.
  if (target.kind === 'unsaved') {
    return chooseAndAdopt(
      platform,
      stateRef,
      recoveryRef,
      patch,
      revision,
      meta.name,
      sessionId,
      sessionDocumentRef,
    );
  }

  const ownershipFailure = await rejectTargetOwnedByAnotherSession(
    platform,
    target,
    s.sessions,
    sessionId,
  );
  if (ownershipFailure) {
    patch({ saveState: 'error', saveIssue: ownershipFailure });
    return { status: 'failed', issue: ownershipFailure };
  }

  if (target.kind === 'download-only') {
    // Browser without the File System Access API: every Save produces a
    // fresh snapshot download. A download is not a persistent location, so
    // the document stays dirty and this never reports "saved to a file".
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    // Mirror to internal storage the way every other branch does. Without
    // this, Firefox and Safari — the browsers that lack File System Access,
    // and so the only ones that ever reach here — downloaded a snapshot and
    // left the browser-local copy untouched, so reopening the document
    // silently restored the state from before the edits. Only for a document
    // that already has an id: minting one here would bind the session to a
    // destination the user never chose, which is what the branch above
    // deliberately avoids.
    if (meta.fileId) await mirror(patch, platform, meta.fileId, meta.name, json);
    patch({ saveState: 'idle', lastSavedAt: Date.now(), saveIssue: null });
    return { status: 'saved' };
  }

  if (target.kind === 'native-file') {
    // Safety checks before overwriting: the destination may be gone (USB
    // unplugged) or changed by another app since we last read/wrote it. Native
    // platforms hash the existing file in bounded chunks so the old document
    // text never crosses IPC or stays resident beside the encoded revision.
    const hashResult = platform.hashDocumentText
      ? await platform.hashDocumentText(target.path)
      : await platform.readDocumentText(target.path);
    const disk =
      !hashResult.ok && hashResult.reason === 'unsupported'
        ? await platform.readDocumentText(target.path)
        : hashResult;
    if (!disk.ok) {
      if (disk.reason === 'unreadable') {
        const e = issue(
          'filesystem-unavailable',
          disk.message
            ? `The original location exists but could not be read (${disk.message}). Use Save As to choose a new location, or retry.`
            : 'The original location exists but could not be read. Use Save As to choose a new location, or retry.',
        );
        patch({ saveState: 'error', saveIssue: e });
        return { status: 'failed', issue: e };
      }
      const e = issue(
        'destination-missing',
        'The original location is unavailable. Use Save As to choose a new location. Recovery continues in the background.',
      );
      patch({ saveState: 'error', saveIssue: e });
      return { status: 'failed', issue: e };
    }
    const diskHash = 'hash' in disk ? disk.hash : contentHash(disk.text);
    if (meta.diskContentHash && diskHash !== meta.diskContentHash) {
      const e = issue(
        'file-changed-externally',
        'The file changed on disk since it was opened. Save As to a new location, or use the File menu to decide how to proceed.',
      );
      patch({ saveState: 'error', saveIssue: e });
      return { status: 'failed', issue: e };
    }
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    // Primary write succeeded. Secondary work (Home mirror, recovery cleanup,
    // thumbnail) must not fail the user's filesystem save.
    const fileId = meta.fileId ?? crypto.randomUUID();
    await mirror(patch, platform, fileId, meta.name, json, { filePath: target.path });
    const update: SessionUpdate = { diskContentHash: contentHash(json), fileId };
    return afterPrimaryWrite(
      platform,
      stateRef,
      recoveryRef,
      patch,
      revision,
      sessionId,
      sessionDocumentRef,
      update,
      meta.name,
    );
  }

  if (target.kind === 'web-file-handle') {
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    const fileId = meta.fileId ?? crypto.randomUUID();
    await mirror(patch, platform, fileId, meta.name, json);
    // Establish the baseline for external-change detection: the next save
    // refuses to overwrite a file whose bytes no longer match this hash.
    const update: SessionUpdate = { fileId, diskContentHash: contentHash(json) };
    return afterPrimaryWrite(
      platform,
      stateRef,
      recoveryRef,
      patch,
      revision,
      sessionId,
      sessionDocumentRef,
      update,
      meta.name,
    );
  }

  // app-storage — the user explicitly chose Varve Library as the document's
  // destination, so a successful library write legitimately marks clean.
  const fileId = meta.fileId ?? target.fileId;
  await mirror(patch, platform, fileId, meta.name, json);
  const update: SessionUpdate = { fileId };
  return afterPrimaryWrite(
    platform,
    stateRef,
    recoveryRef,
    patch,
    revision,
    sessionId,
    sessionDocumentRef,
    update,
    meta.name,
  );
}

/** Save As / first Save: choose a destination, write, adopt only on success. */
async function chooseAndAdopt(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
  name: string | undefined,
  savedSessionId: string,
  sessionDocumentRef: React.MutableRefObject<(sessionId: string) => Document | undefined>,
): Promise<SaveOutcome> {
  const requestedState = stateRef.current;
  const requestedSessionId = savedSessionId;
  const patchRequestedSession = (partial: Partial<EditorState>) => {
    if (stateRef.current.activeId === requestedSessionId) patch(partial);
  };
  const choice = await platform.chooseDocumentSaveTarget(name ?? 'Untitled');
  if (choice.kind === 'cancelled') {
    // Cancellation is normal; it must not change anything (no path change,
    // no identity change, no dirty change) and must not look like a failure.
    patchRequestedSession({ saveState: 'idle' });
    return { status: 'cancelled' };
  }
  if (choice.kind === 'unsupported') {
    return writeFailure(patchRequestedSession, {
      category: 'unsupported',
      message: 'Saving to a file is not available in this mode.',
    });
  }
  if (choice.kind === 'failed') return writeFailure(patchRequestedSession, choice.error);

  const target = choice.target;
  const s = requestedState;
  const meta = s.sessions.find((sess) => sess.id === requestedSessionId);
  const ownershipFailure = await rejectTargetOwnedByAnotherSession(
    platform,
    target,
    stateRef.current.sessions,
    savedSessionId,
  );
  if (ownershipFailure) {
    patchRequestedSession({ saveState: 'error', saveIssue: ownershipFailure });
    return { status: 'failed', issue: ownershipFailure };
  }
  const json = DocumentCodec.encode(revision);
  const written = await platform.writeSaveTarget(target, json);
  if (written.kind !== 'written') {
    // The new destination failed — the CURRENT destination stays untouched.
    return writeFailure(patchRequestedSession, written.error);
  }

  const adopted = adoptTarget(meta, target);
  // Identity is stable across Save As: reuse the existing library entry id so
  // version history, recents, projects, tags and recovery keep their history.
  // A fresh UUID is minted only when the document never had one.
  const fileId = meta?.fileId ?? crypto.randomUUID();

  // A download-only target is not persistent, so it never adopted a location
  // to mirror to. But a document that already has an id has a browser-local
  // copy that is now stale, and leaving it stale is how Firefox and Safari
  // users lost their edits on reload: the snapshot downloaded, the stored
  // copy kept its pre-edit state, and reopening quietly restored that.
  let mirrored = false;
  if (adopted.persistent || meta?.fileId) {
    mirrored = await mirror(
      patchRequestedSession,
      platform,
      fileId,
      adopted.name,
      json,
      adopted.mirrorExtra,
    );
  }
  let cur = stateRef.current;
  let revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
  // A download hand-off is not an authoritative persisted destination. Keep
  // recovery for brand-new documents, and only remove it after a persistent
  // target or the existing library mirror contains this exact snapshot. Also
  // preserve recovery if the user edited again while the mirror was pending.
  if (revisionUnchanged && (adopted.persistent || (meta?.fileId && mirrored))) {
    await recoveryRef.current?.deleteSession(savedSessionId);
    cur = stateRef.current;
    revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
    if (!revisionUnchanged) {
      const recoveryRevision = sessionDocumentRef.current(savedSessionId) ?? revision;
      let currentSession = cur.sessions.find((session) => session.id === savedSessionId);
      await recoveryRef.current?.createRecoveryPoint(
        recoveryRevision,
        currentSession?.name ?? adopted.name,
        currentSession?.fileId,
        currentSession?.filePath,
      );
      cur = stateRef.current;
      revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
      const latestRevision = sessionDocumentRef.current(savedSessionId);
      if (latestRevision && latestRevision !== recoveryRevision) {
        // If another edit arrived during the recovery write, immediately
        // catch up once more. Continued typing is handled by normal recovery
        // scheduling, so a Save As never waits on an unbounded retry loop.
        currentSession = cur.sessions.find((session) => session.id === savedSessionId);
        await recoveryRef.current?.createRecoveryPoint(
          latestRevision,
          currentSession?.name ?? adopted.name,
          currentSession?.fileId,
          currentSession?.filePath,
        );
        cur = stateRef.current;
        revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
      }
    }
  }
  const clean = adopted.persistent && revisionUnchanged;
  const update: SessionUpdate = {
    ...adopted.session,
    fileId,
    name: adopted.name,
    // A successful write to a persistent destination establishes the
    // external-change baseline (native files and browser file handles alike).
    ...(adopted.persistent ? { diskContentHash: contentHash(json) } : {}),
  };
  const sessions = cur.sessions.map((sess) =>
    sess.id === savedSessionId ? { ...sess, ...update, dirty: !clean } : sess,
  );
  patch({
    ...(cur.activeId === savedSessionId
      ? {
          dirty: !clean,
          saveState: clean ? 'saved' : 'idle',
          lastSavedAt: Date.now(),
          saveIssue: null,
        }
      : {}),
    sessions,
  });
  if (clean) {
    // Thumbnail persistence honors the encrypted-project policy: encrypted
    // sessions only ever store the content-free placeholder, never
    // plaintext preview pixels.
    const meta = cur.sessions.find((sess) => sess.id === savedSessionId);
    if (meta?.encrypted) {
      void persistEncryptedThumbnail(platform, json).catch(() => undefined);
    } else {
      void persistFileThumbnail(platform, fileId, revision).catch(() => undefined);
    }
  }
  return { status: 'saved' };
}

/** Save a Copy: write elsewhere, never adopt, never touch dirty state. */
async function performSaveCopy(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
): Promise<SaveOutcome> {
  const s = stateRef.current;
  const meta = s.sessions.find((sess) => sess.id === s.activeId);
  const json = DocumentCodec.encode(s.document);
  const choice = await platform.chooseDocumentSaveTarget(meta?.name ?? 'Untitled');
  if (choice.kind === 'cancelled') {
    patch({ saveState: 'idle' });
    return { status: 'cancelled' };
  }
  if (choice.kind === 'unsupported') {
    return writeFailure(patch, {
      category: 'unsupported',
      message: 'Saving to a file is not available in this mode.',
    });
  }
  if (choice.kind === 'failed') return writeFailure(patch, choice.error);
  const ownershipFailure = await rejectTargetOwnedByAnotherSession(
    platform,
    choice.target,
    s.sessions,
    s.activeId,
  );
  if (ownershipFailure) {
    patch({ saveState: 'error', saveIssue: ownershipFailure });
    return { status: 'failed', issue: ownershipFailure };
  }
  const written = await platform.writeSaveTarget(choice.target, json);
  if (written.kind !== 'written') return writeFailure(patch, written.error);
  // Deliberately no session mutation: the active document keeps its own
  // target, name, and dirty state. A successful copy never clears dirty.
  void revision;
  return { status: 'saved-copy' };
}

/** Refuse writes that would replace another open session's authoritative file. */
async function rejectTargetOwnedByAnotherSession(
  platform: Platform,
  target: SaveTarget,
  sessions: readonly SessionMeta[],
  activeId: string,
): Promise<SaveIssue | null> {
  try {
    for (const session of sessions) {
      if (session.id === activeId) continue;
      const other = saveTargetFromSession(session);
      let same = false;
      if (target.kind === 'native-file' && other.kind === 'native-file') {
        same = await platform.sameNativeFile(target.path, other.path);
      } else if (target.kind === 'web-file-handle' && other.kind === 'web-file-handle') {
        same = await platform.sameWebFileHandle(target.handleId, other.handleId);
      } else if (target.kind === 'app-storage' && other.kind === 'app-storage') {
        same = target.fileId === other.fileId;
      }
      if (same) {
        return issue(
          'destination-in-use',
          'This file is already open in another document. Save to a different location or close the other document first.',
        );
      }
    }
    return null;
  } catch {
    return issue(
      'filesystem-unavailable',
      'Varve could not check whether another open document uses this location. Choose a different location or try again.',
    );
  }
}

/**
 * Success bookkeeping after a write to the authoritative destination:
 * recovery cleanup, revision-aware clean marking, thumbnail follow-up.
 */
async function afterPrimaryWrite(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
  savedSessionId: string,
  sessionDocumentRef: React.MutableRefObject<(sessionId: string) => Document | undefined>,
  update: SessionUpdate,
  name: string,
): Promise<SaveOutcome> {
  let cur = stateRef.current;
  let revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
  if (revisionUnchanged) {
    await recoveryRef.current?.deleteSession(savedSessionId);
    cur = stateRef.current;
    revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
    if (!revisionUnchanged) {
      let latestRevision = sessionDocumentRef.current(savedSessionId) ?? revision;
      let currentSession = cur.sessions.find((session) => session.id === savedSessionId);
      await recoveryRef.current?.createRecoveryPoint(
        latestRevision,
        currentSession?.name ?? name,
        currentSession?.fileId,
        currentSession?.filePath,
      );
      cur = stateRef.current;
      revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
      const afterRecovery = sessionDocumentRef.current(savedSessionId);
      if (afterRecovery && afterRecovery !== latestRevision) {
        latestRevision = afterRecovery;
        currentSession = cur.sessions.find((session) => session.id === savedSessionId);
        await recoveryRef.current?.createRecoveryPoint(
          latestRevision,
          currentSession?.name ?? name,
          currentSession?.fileId,
          currentSession?.filePath,
        );
        cur = stateRef.current;
        revisionUnchanged = sessionDocumentRef.current(savedSessionId) === revision;
      }
    }
  }
  const clean = revisionUnchanged;
  const sessions = cur.sessions.map((sess) =>
    sess.id === savedSessionId ? { ...sess, ...update, name, dirty: !clean } : sess,
  );
  patch({
    ...(cur.activeId === savedSessionId
      ? {
          dirty: !clean,
          saveState: clean ? 'saved' : 'idle',
          lastSavedAt: Date.now(),
          saveIssue: null,
        }
      : {}),
    sessions,
  });
  if (clean) {
    // Thumbnail persistence honors the encrypted-project policy: encrypted
    // sessions only ever store the content-free placeholder, never
    // plaintext preview pixels.
    const meta = cur.sessions.find((sess) => sess.id === savedSessionId);
    if (meta?.encrypted) {
      void persistEncryptedThumbnail(platform, DocumentCodec.encode(revision)).catch(
        () => undefined,
      );
    } else if (update.fileId) {
      void persistFileThumbnail(platform, update.fileId, revision).catch(() => undefined);
    } else {
      persistProjectThumbnail(platform, revision);
    }
  }
  return { status: 'saved' };
}

/** Internal Home mirror. Secondary persistence: a mirror failure never fails
 *  the user's primary filesystem save (§58 primary vs secondary). */
async function mirror(
  _patch: (partial: Partial<EditorState>) => void,
  platform: Platform,
  fileId: string,
  name: string,
  json: string,
  extra?: { filePath?: string },
): Promise<boolean> {
  try {
    await upsertPreservingMeta(platform, fileId, name, json, extra);
    return true;
  } catch {
    // Home cache/thumbnail index update failed — the primary write already
    // succeeded; log and continue rather than flipping the save to failed.
    if (typeof console !== 'undefined') {
      console.warn('[Varve] internal index mirror failed for', fileId);
    }
    return false;
  }
}

function writeFailure(
  patch: (partial: Partial<EditorState>) => void,
  error: SaveIssue,
): SaveOutcome {
  patch({ saveState: 'error', saveIssue: error });
  return { status: 'failed', issue: error };
}

function issue(category: SaveIssue['category'], message: string): SaveIssue {
  return { category, message };
}

interface AdoptedTarget {
  /** Session fields to adopt on the active tab. */
  session: SessionUpdate;
  /** Display name derived from the destination. */
  name: string;
  /** Whether the destination should be mirrored into the Home index. */
  persistent: boolean;
  mirrorExtra?: { filePath?: string };
}

function adoptTarget(
  meta: SessionFileMeta | undefined,
  target: ReturnType<typeof saveTargetFromSession>,
): AdoptedTarget {
  // Any real destination choice clears an earlier explicit library choice.
  const base = { libraryStorage: undefined };
  switch (target.kind) {
    case 'native-file':
      return {
        session: {
          ...base,
          filePath: target.path,
          saveHandleId: undefined,
          saveHandleName: undefined,
          downloadName: undefined,
          diskContentHash: undefined,
        },
        name: displayNameFromPath(target.path),
        persistent: true,
        mirrorExtra: { filePath: target.path },
      };
    case 'web-file-handle':
      return {
        session: {
          ...base,
          filePath: undefined,
          saveHandleId: target.handleId,
          saveHandleName: target.displayName,
          downloadName: undefined,
          diskContentHash: undefined,
        },
        name: stripExtension(target.displayName),
        persistent: true,
      };
    case 'download-only':
      return {
        session: {
          ...base,
          filePath: undefined,
          saveHandleId: undefined,
          saveHandleName: undefined,
          downloadName: target.suggestedName,
          diskContentHash: undefined,
        },
        name: stripExtension(target.suggestedName),
        persistent: false,
      };
    default:
      return { session: base, name: meta?.name ?? 'Untitled', persistent: false };
  }
}

/**
 * Re-resolve a document's font manifest against the current device's font
 * catalog. Exported so every path that brings a document in from outside —
 * loadDocument and the editor context's openFile — resolves fonts the same
 * way; a document opened on a different machine otherwise keeps the authoring
 * machine's unresolved manifest.
 *
 *
 * If the document already has a font manifest, its entries are re-resolved
 * against the locally available fonts (handles cross-device opening). If the
 * document has no manifest (legacy pre-v2.9), a new one is built from scratch.
 *
 * Returns the document with an updated `fontManifest` field.
 */
export function resolveFontManifest(doc: Document): Document {
  if (hasTextNodes(doc) === false) {
    return doc;
  }

  const catalog = createFontCatalogFromRegistry(getFontRegistry());

  const { manifest } = attachFontManifestToDocument(
    { nodes: doc.nodes, styles: doc.styles, fontManifest: doc.fontManifest } as Parameters<
      typeof attachFontManifestToDocument
    >[0],
    catalog,
  );
  return { ...doc, fontManifest: manifest };
}

/** Check if a document contains any text nodes that reference fonts. */
function hasTextNodes(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'text') continue;
    if (node.fontFamily) return true;
    if (
      node.richText?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => Boolean(run.format?.fontFamily)),
      )
    ) {
      return true;
    }
  }
  for (const style of Object.values(doc.styles ?? {})) {
    if (style.type === 'text' && 'fontFamily' in style && style.fontFamily) return true;
  }
  return false;
}

/**
 * Generate + persist the file's canonical thumbnail after a save, honoring
 * the user's persisted source preference (read back from the platform index
 * so the editor and Home always agree on the source).
 */
async function persistFileThumbnail(
  platform: Platform,
  fileId: string,
  document: Document,
): Promise<void> {
  const entry = await platform.getFile(fileId);
  await persistProjectThumbnail(platform, document, {
    fileId,
    preference: entry?.thumbnailPreference,
  });
}

/**
 * Encrypted-session thumbnail policy: remove any plaintext preview for this
 * document and store only the content-free encrypted placeholder.
 */
async function persistEncryptedThumbnail(platform: Platform, documentJson: string): Promise<void> {
  try {
    const { clearProjectPreviewData, createEncryptedThumbnailRecord } = await import(
      '../thumbnail/encryptedThumbnailPolicy'
    );
    const hash = contentHash(documentJson);
    await clearProjectPreviewData(platform, hash);
    await platform.putThumbnail(createEncryptedThumbnailRecord(hash));
  } catch {
    // Best-effort: placeholder write failure is non-fatal.
  }
}
