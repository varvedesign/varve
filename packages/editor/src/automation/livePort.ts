/**
 * The editor's half of a connected automation session.
 *
 * `LiveAuthority` (in `@varve/automation`) decides *whether* a command may be
 * applied; this decides *how* a document produced by a pure command function
 * becomes real editor state. It is the only place an automation command can
 * touch the editor, and it is deliberately the editor's own path: one
 * `groupCompoundOperation`, one `updateDoc`, one undo entry, the editor's own
 * label, the editor's own dirty/revision bookkeeping. No second state store and
 * no second history stack exists.
 *
 * ## Why the revision is derived, not read
 *
 * A connected client plans against a revision and the commit is refused if that
 * revision moved. `state.revision` cannot carry that on its own:
 *
 * - React applies `updateDoc` in a deferred flush, so the revision read
 *   immediately after installing is one render stale.
 * - Undo and history restore swap the document without necessarily going
 *   through `updateDoc`, so a counter that only `updateDoc` bumps can miss a
 *   change entirely.
 *
 * So the port keeps its own monotonic number and derives it from two signals:
 * the editor's counter as a floor, and the **identity of the document** the
 * editor is holding. A document it has never seen is a change, whether it came
 * from a person, an undo, or an install of ours. `observe()` lets the editor
 * report every state change it renders, which closes the one window identity
 * alone cannot: a personal edit that is undone again before the next command,
 * leaving the same document object in place.
 */

import type { Availability, CommitInput, CommitResult, LiveEditorPort } from '@varve/automation';
import type { Document } from '@varve/scene';

/** What an automation session needs to know about the editor, read synchronously. */
export interface LiveEditorSnapshot {
  document: Document;
  /** The editor's own monotonic revision counter (`EditorState.revision`). */
  revision: number;
  /**
   * Identity of the open document session (`EditorState.activeId`). A different
   * value means this client is attached to a session that no longer exists.
   */
  sessionId: string;
  /**
   * True while the editor holds an open transaction: a person is mid-drag,
   * mid-scrub or mid-composition. Installing now would fold an agent's change
   * into that person's undo step, or lose it if they cancel, so the port
   * refuses and the client retries.
   */
  transactionOpen?: boolean;
  /**
   * The content root the editor's own tools insert new layers into: the active
   * design canvas in a design workspace, the active page in a publishing one.
   * Absent when the editor cannot say, which leaves the headless default.
   */
  defaultParentId?: string;
}

export interface LiveEditorBindings {
  /**
   * The editor's *current* state, read from a ref rather than the rendered
   * value, so a check followed by an install cannot straddle a flush.
   */
  read(): LiveEditorSnapshot;
  /**
   * Install a whole document as one labelled history step, through the editor's
   * own transaction and label path.
   *
   * `expected` is the document the plan was computed against. The editor applies
   * the change only if its state still holds exactly that document at the moment
   * the update runs, so a person's edit that was queued but not yet rendered is
   * never overwritten:
   *
   * - `applied`  the document was installed;
   * - `stale`    the editor's state had already moved on, nothing was changed;
   * - `refused`  the editor could not apply it at all (no document session).
   */
  install(label: string, doc: Document, expected: Document): 'applied' | 'stale' | 'refused';
}

export interface LivePortOptions {
  bindings: LiveEditorBindings;
  /**
   * Stable for the lifetime of the application window. Reported to clients so
   * two windows of the same document are distinguishable.
   */
  instanceId: string;
  /**
   * Identifies this attachment. Defaults to the document session id; a caller
   * that rebuilds a port for a session it returns to should pass a fresh value
   * so a client from an earlier attachment can never mistake it for its own.
   */
  generation?: string;
}

export interface EditorLivePort extends LiveEditorPort {
  /**
   * Report a state change the editor rendered. The hook calls this from an
   * effect so a change cannot be missed between two commands.
   */
  observe(snapshot: LiveEditorSnapshot): void;
  /** The derived revision, for diagnostics and tests. */
  currentRevision(): number;
}

export function createLiveEditorPort(options: LivePortOptions): EditorLivePort {
  const { bindings } = options;
  const first = bindings.read();
  const pinnedSessionId = first.sessionId;

  let own = first.revision;
  let lastSeen: Document = first.document;
  /** The editor's counter as of the previous reconciliation. */
  let lastRevision = first.revision;
  /** Documents we installed that the editor has not shown back to us yet. */
  const pending: Document[] = [];

  /**
   * Reconcile our number with the editor's, and return the current revision.
   * Runs on every read so a client never plans against a stale floor.
   *
   * The two signals overlap on purpose and must not be added together: an edit
   * that goes through `updateDoc` moves *both* the counter and the document
   * identity, and counting it twice would make an honest client look stale.
   * The counter is the floor; identity only adds a step for a change the
   * counter did not record (an undo, a history restore, an opened file).
   */
  function sync(snapshot: LiveEditorSnapshot): number {
    if (snapshot.revision > own) own = snapshot.revision;
    if (snapshot.document !== lastSeen) {
      const installedIndex = pending.indexOf(snapshot.document);
      if (installedIndex >= 0) {
        // An install of ours reached the render. It is already counted.
        pending.splice(0, installedIndex + 1);
      } else if (snapshot.revision <= lastRevision) {
        // The document changed without the editor's counter moving.
        pending.length = 0;
        own += 1;
      } else {
        // A counter-mediated change we did not make. Already counted by the
        // floor above; only the bookkeeping moves.
        pending.length = 0;
      }
      lastSeen = snapshot.document;
    }
    lastRevision = snapshot.revision;
    return own;
  }

  function snapshot(): LiveEditorSnapshot {
    return bindings.read();
  }

  return {
    info() {
      const now = snapshot();
      return {
        instanceId: options.instanceId,
        // The session this port was built for. It never changes under a client:
        // a replaced session is refused rather than silently followed.
        generation: options.generation ?? pinnedSessionId,
        documentId: now.document.id,
        documentName: now.document.name,
      };
    },

    revision() {
      return sync(snapshot());
    },

    currentRevision() {
      return sync(snapshot());
    },

    document() {
      return snapshot().document;
    },

    defaultParentId() {
      return snapshot().defaultParentId;
    },

    status(): Availability {
      const now = snapshot();
      if (now.sessionId !== pinnedSessionId) {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message:
            'the document session this client attached to is closed or is no longer the active tab',
          hint: 'attaching never retargets a session; attach again to the document that is open now',
        };
      }
      return { ok: true };
    },

    install(input: CommitInput): CommitResult {
      const now = snapshot();
      const current = sync(now);
      if (now.transactionOpen) {
        return {
          ok: false,
          reason: 'unavailable',
          code: 'CONFLICT',
          message:
            'a person is in the middle of an edit (a drag, a slider scrub or a text composition); nothing was changed',
        };
      }
      if (input.baseRevision !== current) {
        return { ok: false, reason: 'revision-conflict', currentRevision: current };
      }
      if (input.plan.doc === now.document) {
        // `updateDoc` treats an identical reference as a no-op: no history entry
        // and no revision bump. Reporting success here would advance a revision
        // nothing moved, so the next stale-plan check would be worthless.
        return {
          ok: false,
          reason: 'unavailable',
          code: 'INVARIANT_VIOLATION',
          message:
            'the planned document is the document already loaded, so applying it would change nothing',
        };
      }
      const outcome = bindings.install(input.plan.label, input.plan.doc, now.document);
      if (outcome === 'stale') {
        // The editor's state moved between our read and the update running. The
        // person's edit wins; the client re-plans against the new revision.
        return {
          ok: false,
          reason: 'revision-conflict',
          currentRevision: sync(snapshot()),
        };
      }
      if (outcome === 'refused') {
        return {
          ok: false,
          reason: 'unavailable',
          code: 'UNAVAILABLE',
          message: 'the editor has no document session to apply this change to',
        };
      }
      pending.push(input.plan.doc);
      own = current + 1;
      return { ok: true, revision: own, transactionId: `live-${own}` };
    },

    observe(next: LiveEditorSnapshot) {
      sync(next);
    },
  };
}
