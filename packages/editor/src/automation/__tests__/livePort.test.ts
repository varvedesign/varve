import { createDocument, type Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  createLiveEditorPort,
  type LiveEditorBindings,
  type LiveEditorSnapshot,
} from '../livePort';

/**
 * A stand-in for the editor's state and transaction path, faithful about the
 * part that matters: `install` is only reflected in the next snapshot, the way
 * React's deferred flush defers it.
 */
class FakeEditorState implements LiveEditorBindings {
  document: Document;
  revision = 0;
  sessionId = 'session-1';
  /** Labels the editor recorded, one per committed history step. */
  readonly undo: string[] = [];
  /** When true, `install` is accepted but the document does not change. */
  refuseInstall = false;
  /** When true, a person's edit does not bump `revision` (the undo-like path). */
  silentRevision = false;
  /** When true, the editor has an open transaction (a person is mid-gesture). */
  transactionOpen = false;

  constructor(document = createDocument('Live')) {
    this.document = document;
  }

  read(): LiveEditorSnapshot {
    return {
      document: this.document,
      revision: this.revision,
      sessionId: this.sessionId,
      transactionOpen: this.transactionOpen,
    };
  }

  install(label: string, doc: Document): boolean {
    if (this.refuseInstall) return false;
    this.document = doc;
    if (!this.silentRevision) this.revision += 1;
    this.undo.push(label);
    return true;
  }

  /** A person editing: a new document object, through the editor's own path. */
  person(next: Document, { bumpsRevision = true } = {}): void {
    this.document = next;
    if (bumpsRevision) this.revision += 1;
    this.undo.push('Person edit');
  }
}

function setup() {
  const editor = new FakeEditorState();
  const port = createLiveEditorPort({ bindings: editor, instanceId: 'window-1' });
  return { editor, port };
}

function renamed(doc: Document, name: string): Document {
  return { ...doc, name };
}

describe('editor live port', () => {
  it('reports the session it was built for and never adopts another', () => {
    const { editor, port } = setup();
    expect(port.info()).toMatchObject({
      instanceId: 'window-1',
      generation: 'session-1',
      documentId: editor.document.id,
    });
    expect(port.status()).toEqual({ ok: true });

    // A tab switch is a different session: refuse rather than retarget.
    editor.sessionId = 'session-2';
    const status = port.status();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.code).toBe('UNAVAILABLE');
      expect(status.message).toContain('no longer the active tab');
    }
  });

  it('advances the revision on a commit and reports the same number twice', () => {
    const { editor, port } = setup();
    const before = port.revision();
    const result = port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: before,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.revision).toBe(before + 1);
    // Reading again before the editor's flush must not double count.
    expect(port.revision()).toBe(before + 1);
    expect(port.revision()).toBe(before + 1);
    expect(editor.undo).toEqual(['Rename']);
  });

  it('does not double count once the editor reflects the install', () => {
    const { editor, port } = setup();
    const before = port.revision();
    port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: before,
    });
    // The editor's counter and ours agree; neither adds a phantom step.
    expect(port.revision()).toBe(editor.revision);
    expect(port.revision()).toBe(before + 1);
  });

  it('refuses a plan whose revision moved', () => {
    const { editor, port } = setup();
    const stale = port.revision();
    editor.person(renamed(editor.document, 'Person'));
    const result = port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: stale,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'revision-conflict') {
      expect(result.currentRevision).toBe(stale + 1);
    } else {
      throw new Error(`expected a revision conflict, got ${JSON.stringify(result)}`);
    }
    expect(editor.undo).toEqual(['Person edit']);
  });

  it('catches a change that leaves the editor’s own counter untouched', () => {
    const { editor, port } = setup();
    const stale = port.revision();
    // An undo or history restore swaps the document without bumping `revision`.
    editor.person(renamed(editor.document, 'Restored'), { bumpsRevision: false });
    expect(port.revision()).toBe(stale + 1);
    const result = port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: stale,
    });
    expect(result.ok).toBe(false);
  });

  it('closes the window a reverted change would otherwise hide in', () => {
    const { editor, port } = setup();
    const seen = port.revision();
    const original = editor.document;
    // A person edits and undoes it again between two commands. Identity alone
    // would see the original document and believe nothing happened; the
    // observed intermediate state is what makes the revision honest.
    const edited = renamed(original, 'Edited');
    port.observe({ document: edited, revision: editor.revision + 1, sessionId: editor.sessionId });
    port.observe({
      document: original,
      revision: editor.revision + 2,
      sessionId: editor.sessionId,
    });
    expect(port.revision()).toBeGreaterThan(seen);
  });

  it('refuses a plan that would change nothing instead of advancing a revision', () => {
    const { editor, port } = setup();
    const result = port.install({
      plan: {
        doc: editor.document,
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: port.revision(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'unavailable') {
      expect(result.code).toBe('INVARIANT_VIOLATION');
    } else {
      throw new Error(`expected an invariant refusal, got ${JSON.stringify(result)}`);
    }
  });

  it('reports an editor that refuses the install as unavailable, not as applied', () => {
    const { editor, port } = setup();
    editor.refuseInstall = true;
    const result = port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Rename',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: port.revision(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'unavailable') {
      expect(result.code).toBe('UNAVAILABLE');
      expect(result.message).toContain('no document session');
    } else {
      throw new Error(`expected an unavailable refusal, got ${JSON.stringify(result)}`);
    }
    expect(editor.undo).toEqual([]);
  });

  it('keeps the number monotonic across a person’s edit after an agent commit', () => {
    const { editor, port } = setup();
    const start = port.revision();
    port.install({
      plan: {
        doc: renamed(editor.document, 'Agent'),
        label: 'Agent',
        created: [],
        changed: [],
        deleted: [],
      },
      origin: { principalId: 'p', kind: 'agent', label: 'agent', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: start,
    });
    editor.person(renamed(editor.document, 'Person'));
    const after = port.revision();
    expect(after).toBeGreaterThan(start + 1);
    // Both edits are accounted for, and never by going backwards.
    const again = port.revision();
    expect(again).toBe(after);
  });

  it('refuses to install while a person has an open transaction, and installs once it closes', () => {
    const { editor, port } = setup();
    const base = port.revision();
    editor.transactionOpen = true;
    const planned = renamed(editor.document, 'Agent edit');
    const refused = port.install({
      plan: { doc: planned, label: 'Rename', created: [], changed: [], deleted: [] },
      origin: { principalId: 'a', kind: 'agent', label: 'a', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r1',
      baseRevision: base,
    });
    expect(refused).toMatchObject({ ok: false, reason: 'unavailable', code: 'CONFLICT' });
    expect(editor.undo).toEqual([]);
    expect(editor.document.name).toBe('Live');
    expect(port.revision()).toBe(base);

    editor.transactionOpen = false;
    const accepted = port.install({
      plan: { doc: planned, label: 'Rename', created: [], changed: [], deleted: [] },
      origin: { principalId: 'a', kind: 'agent', label: 'a', transport: 'ipc' },
      command: 'varve.node.set',
      receiptId: 'r2',
      baseRevision: base,
    });
    expect(accepted.ok).toBe(true);
    expect(editor.undo).toEqual(['Rename']);
  });
});
