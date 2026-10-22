import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, markDocumentDirty, useEditor } from '../../context';
import { collectUnsavedDocuments } from '../../lifecycle/dirtyRegistry';
import type { DirtyScope, EditorLifecycleApi } from '../../lifecycle/types';
import type { EditorState } from '../types';

/**
 * Unsaved-work bookkeeping has one authority.
 *
 * `state.dirty` and `sessions[activeId].dirty` describe the same fact but are
 * read by different surfaces: the tab strip and the save-status affordance read
 * the state flag, while the tab close guard (`closeTab`) and the termination
 * coordinator (`collectUnsavedDocuments`) read the session flag. A mutation
 * that updated only the state flag made a real edit look saved to the close
 * path, so the tab closed with no prompt and the recovery point was deleted on
 * the resulting clean shutdown.
 *
 * Reported upstream as OpenPencil #698 ("closing an unsaved document discards
 * work silently, no save prompt").
 */
describe('unsaved-work bookkeeping', () => {
  function mount() {
    let editor: ReturnType<typeof useEditor> | undefined;
    function Consumer() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider>
        <Consumer />
      </EditorProvider>,
    );
    return () => {
      if (!editor) throw new Error('editor not ready');
      return editor;
    };
  }

  function activeSessionDirty(state: EditorState) {
    return state.sessions.find((session) => session.id === state.activeId)?.dirty;
  }

  /**
   * Only the two reads the collector performs are meaningful here; the rest of
   * the lifecycle API is unreachable from a dirty-scope collection.
   */
  function lifecycleApiFor(state: EditorState): EditorLifecycleApi {
    const unimplemented = () => {
      throw new Error('not used by collectUnsavedDocuments');
    };
    return {
      getSessions: () => state.sessions,
      getActiveSessionId: () => state.activeId,
      saveSession: unimplemented,
      saveSessionAs: unimplemented,
      isSessionDirty: unimplemented,
      closeTab: unimplemented,
      switchTab: unimplemented,
      getLastSaveFailure: unimplemented,
      goHome: unimplemented,
    } as unknown as EditorLifecycleApi;
  }

  function collectFor(state: EditorState, scope: DirtyScope) {
    return collectUnsavedDocuments(lifecycleApiFor(state), scope);
  }

  it('marks both flags when a document is marked dirty', () => {
    const base = {
      dirty: false,
      activeId: 'a',
      sessions: [
        { id: 'a', name: 'Untitled', dirty: false },
        { id: 'b', name: 'Other', dirty: false },
      ],
    } as unknown as EditorState;

    const next = markDocumentDirty(base);

    expect(next.dirty).toBe(true);
    expect(next.sessions.find((s) => s.id === 'a')?.dirty).toBe(true);
    // Only the active session is affected.
    expect(next.sessions.find((s) => s.id === 'b')?.dirty).toBe(false);
  });

  it('is idempotent and never clears an existing flag', () => {
    const base = {
      dirty: true,
      activeId: 'a',
      sessions: [{ id: 'a', name: 'Untitled', dirty: true }],
    } as unknown as EditorState;

    expect(markDocumentDirty(base)).toBe(base);
  });

  it('leaves the session flag behind if only the state flag were set, and repairs it', () => {
    const stale = {
      dirty: true,
      activeId: 'a',
      sessions: [{ id: 'a', name: 'Untitled', dirty: false }],
    } as unknown as EditorState;

    const repaired = markDocumentDirty(stale);

    expect(repaired.dirty).toBe(true);
    expect(repaired.sessions[0]?.dirty).toBe(true);
  });

  it('a grouped document is unsaved work for the close guard', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 0, y: 0 }, { w: 40, h: 40 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const first = get().state.selection[0]!;

    act(() => {
      get().createShapeAt({ x: 100, y: 0 }, { w: 40, h: 40 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const second = get().state.selection[0]!;

    // Select both and group them: a grouping edit, recorded as one undo step.
    act(() => {
      get().setSelection(first);
      get().toggleSelection(second, true);
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(2));

    act(() => {
      get().groupSelected();
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));

    // The grouping is a real edit, so the session must report unsaved work.
    expect(activeSessionDirty(get().state)).toBe(true);
    expect(get().state.dirty).toBe(true);

    // ...and the close guard must refuse to close without a prompt.
    expect(get().closeTab(get().state.activeId)).toBe(false);
  });

  it('an identical operation that writes through the document setter keeps both flags in step', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 0, y: 0 }, { w: 40, h: 40 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;

    // A plain document mutation goes through updateDoc, whose bookkeeping is
    // the reference implementation this test protects.
    act(() => {
      get().updateNode(id, (node) => ({ ...node, opacity: 0.5 }));
    });
    await waitFor(() => expect(get().state.document.nodes[id]?.opacity).toBe(0.5));

    expect(activeSessionDirty(get().state)).toBe(true);
  });

  it('does not report unsaved work for a freshly opened document', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    expect(get().state.dirty).toBe(false);
    expect(activeSessionDirty(get().state)).toBe(false);
  });

  it('a stale session flag hides real edits from the termination coordinator', () => {
    // The defect this batch fixes, reproduced at the boundary that decides
    // whether work can be destroyed: a mutation wrote only `state.dirty`, so
    // the collector returned nothing to save.
    const stale = {
      dirty: true,
      activeId: 'a',
      sessions: [{ id: 'a', name: 'Untitled', filePath: undefined, dirty: false }],
    } as unknown as EditorState;
    expect(collectFor(stale, 'document')).toHaveLength(0);
  });

  it('the single authority makes the same edit visible to the coordinator', () => {
    const stale = {
      dirty: true,
      activeId: 'a',
      sessions: [{ id: 'a', name: 'Untitled', filePath: undefined, dirty: false }],
    } as unknown as EditorState;
    const marked = markDocumentDirty(stale);
    const unsaved = collectFor(marked, 'document');
    expect(unsaved).toHaveLength(1);
    expect(unsaved[0]).toMatchObject({ sessionId: 'a', name: 'Untitled', untitled: true });
  });
});
