/**
 * Document-switch ownership for document-scoped surfaces.
 *
 * PDFCraft #3917 reports a reload or OS "open" switching the document under an
 * open dialog, so OK applies to the wrong document. Varve's rule is that a
 * surface acts on the *live* document it can see, never on a captured copy,
 * and document-scoped targets (selection, node ids) are cleared when the
 * document is replaced. These tests pin the observable half of that rule:
 * after a replacement, the editor has no selection from the previous document
 * and the new document is authoritative.
 *
 * The other half is source-level: dialogs derive their targets from
 * `state.document` / `state.selection` on every render (for example
 * `components/Upscale/UpscaleDialogHost.tsx` re-derives its batch on a
 * document change), and the save engine is revision-safe, so a stale save can
 * never mark newer edits clean.
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
});
