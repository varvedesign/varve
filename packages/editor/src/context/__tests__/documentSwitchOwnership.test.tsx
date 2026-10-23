/**
 * Document-switch ownership for document-scoped surfaces.
 *
 * PDFCraft #3917 reports a reload or OS "open" switching the document under an
 * open dialog, so OK applies to the wrong document. These baseline tests pin
 * selection and save identity when the document is replaced:
 * after a replacement, the editor has no selection from the previous document
 * and the new document is authoritative.
 *
 * They do NOT establish modal target ownership: re-deriving a dialog's target
 * from the newly active document can itself be the bug. Reload / OS-open /
 * drag-and-drop under an open modal still require real workflow coverage;
 * PDFCraft #3917 remains open in the review ledger.
 */
import { act, render } from '@testing-library/react';
import { addNode, createDocument, DocumentCodec, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Probe() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <Probe />
    </EditorProvider>,
  );
  return () => {
    if (!ctx) throw new Error('editor context not mounted');
    return ctx;
  };
}

function docWithRect(name: string, id: string) {
  return addNode(
    createDocument(name),
    makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 40, h: 30 }, { name: 'Rect' }),
  );
}

describe('document replacement ownership', () => {
  it('drops the previous document selection so dialogs have no stale target', () => {
    const getCtx = mountEditor();
    const first = docWithRect('First', 'rect-a');
    act(() => {
      getCtx().loadDocument(DocumentCodec.encode(first), { name: 'First', newSession: true });
    });
    const firstId = getCtx().state.document.id;

    act(() => {
      getCtx().setSelection('rect-a');
    });
    expect(getCtx().state.selection).toEqual(['rect-a']);

    const second = docWithRect('Second', 'rect-b');
    act(() => {
      getCtx().loadDocument(DocumentCodec.encode(second), {
        name: 'Second',
        newSession: true,
      });
    });

    // A new document with its own identity, and no selection carried across:
    // a selection-scoped dialog now sees zero targets in the new document.
    expect(getCtx().state.document.id).not.toBe(firstId);
    expect(getCtx().state.selection).toEqual([]);
    expect(getCtx().state.document.nodes['rect-b']).toBeDefined();
    expect(getCtx().state.document.nodes['rect-a']).toBeUndefined();
  });

  it('reports the live document in a document-scoped surface after a switch', () => {
    const getCtx = mountEditor();
    act(() => {
      getCtx().openFile('file-a', 'Design A', '/docs/a.varve', null);
    });
    const sessionBefore = getCtx().state.sessions.find((s) => s.id === getCtx().state.activeId);
    expect(sessionBefore?.filePath).toBe('/docs/a.varve');

    // Replacing the content of the active tab without `keepIdentity` must not
    // keep the old destination: an open "where is this saved?" surface reads
    // the session, so it can only describe the document now in the tab.
    act(() => {
      getCtx().loadDocument(DocumentCodec.encode(docWithRect('Replacement', 'rect-c')), {
        name: 'Replacement',
      });
    });
    const sessionAfter = getCtx().state.sessions.find((s) => s.id === getCtx().state.activeId);
    expect(sessionAfter?.filePath).toBeUndefined();
    expect(sessionAfter?.name).toBe('Replacement');
  });

  it('returns a definite load outcome without changing the active work on decode failure', () => {
    const getCtx = mountEditor();
    act(() => {
      expect(
        getCtx().loadDocument(DocumentCodec.encode(docWithRect('Kept', 'kept')), {
          name: 'Kept',
          newSession: true,
        }),
      ).toBe(true);
    });
    const before = getCtx().state;
    act(() => {
      expect(getCtx().loadDocument('{invalid-json', { newSession: true })).toBe(false);
    });
    expect(getCtx().state.document).toBe(before.document);
    expect(getCtx().state.sessions).toBe(before.sessions);
    expect(getCtx().state.activeId).toBe(before.activeId);
  });
});
