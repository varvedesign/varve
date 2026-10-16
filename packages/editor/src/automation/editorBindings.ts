/**
 * Bindings between an automation session and the real editor.
 *
 * Two jobs, and the reason they are in the editor package: reading the
 * editor's state *now* (not as of the last render a closure captured), and
 * installing a planned document through the editor's own history path.
 *
 * Installing goes through exactly what a person's edit does: one
 * `groupCompoundOperation`, one `updateDoc`, one undo step with the command's
 * own label. The update is a compare-and-swap inside the reducer, so a
 * person's edit that is queued but has not rendered yet is never overwritten,
 * and `flushSync` makes the outcome known before this returns, so the receipt
 * reports what actually happened rather than what was requested.
 */
import { flushSync } from 'react-dom';
import type { EditorContextValue } from '../context';
import { activeWorkspaceContentRoot } from '../scene/activeWorkspace';
import type { LiveEditorBindings, LiveEditorSnapshot } from './livePort';

export function createEditorBindings(source: () => EditorContextValue | null): LiveEditorBindings {
  // The last snapshot seen, so a window that closes under a client still has an
  // identity to report (with a session id that makes `status()` refuse).
  let lastKnown: LiveEditorSnapshot | null = null;

  return {
    read(): LiveEditorSnapshot {
      const editor = source();
      if (!editor) {
        if (lastKnown) return { ...lastKnown, sessionId: '', transactionOpen: false };
        throw new Error('the editor is not mounted');
      }
      const now = editor.readAutomationState();
      lastKnown = {
        document: now.document,
        revision: now.revision,
        sessionId: now.sessionId,
        transactionOpen: now.transactionOpen,
        // The surface the person is looking at, by the rule the editor's own
        // tools use. A node placed anywhere else renders but never appears in
        // the Layers panel or on the canvas.
        ...(() => {
          const root = activeWorkspaceContentRoot(now.document, now.workspaceMode);
          return root ? { defaultParentId: root } : {};
        })(),
      };
      return lastKnown;
    },

    install(label, doc, expected) {
      const editor = source();
      if (!editor) return 'refused';
      let outcome: 'applied' | 'stale' = 'stale';
      flushSync(() => {
        editor.groupCompoundOperation(label, () => {
          editor.updateDoc((current) => {
            if (current !== expected) return current;
            outcome = 'applied';
            return doc;
          });
        });
      });
      return outcome;
    },
  };
}
