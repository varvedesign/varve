import { act, render, waitFor } from '@testing-library/react';
import { createDocument, DocumentCodec } from '@varve/scene';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

/**
 * The host hands the same open request to the provider twice: once as
 * `initialDocumentJson`, which becomes the bootstrap session, and once via
 * `openFile`. The bootstrap session used to carry no file identity, so
 * `openFile`'s dedupe — which matches on file id or path — could not recognise
 * it and opened the same document a second time, leaving two tabs on one file.
 *
 * The fixtures go through `DocumentCodec.encode(createDocument(...))` on
 * purpose. A hand-built `{ id, name, nodes, rootChildren }` object is missing
 * `components` and `nextId`, so `openFile` refuses it before dedupe is ever
 * consulted — a test built that way can pass while dedupe is completely broken
 * (the first case below passed for exactly that reason; vectorcraft#861).
 */
function docJson(name: string): string {
  return DocumentCodec.encode(createDocument(name));
}

function docId(json: string): string {
  const decoded = DocumentCodec.decode(json);
  if (!decoded.ok) throw new Error(`fixture did not decode: ${decoded.error}`);
  return decoded.document.id;
}

function Harness({ onReady }: { onReady: (ctx: ReturnType<typeof useEditor>) => void }) {
  const ctx = useEditor();
  React.useEffect(() => {
    onReady(ctx);
  });
  return null;
}

describe('opening the bootstrapped file again', () => {
  it('reuses the bootstrap session instead of adding a second tab', async () => {
    const first = docJson('DesignFile1');
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={first}
        initialDocumentName="DesignFile1"
        initialFileId="file-1"
      >
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );

    await waitFor(() => expect(ctx).toBeDefined());
    expect(ctx?.state.sessions).toHaveLength(1);
    const bootstrapSessionId = ctx?.state.sessions[0]?.id;

    // The host's openFile dispatch for the very file already bootstrapped.
    act(() => {
      ctx?.openFile('file-1', 'DesignFile1', undefined, first);
    });
    // Settle the state update before asserting — a waitFor on the count can
    // observe the pre-update value and pass while a duplicate is being added.
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions).toHaveLength(1);
    expect(ctx?.state.sessions[0]?.id).toBe(bootstrapSessionId);
    expect(ctx?.state.sessions.map((s) => s.name)).toEqual(['DesignFile1']);
    expect(ctx?.state.sessions[0]?.fileId).toBe('file-1');
    // The open was a switch, not a reload: the document the user already had
    // in memory is the one still mounted.
    expect(ctx?.state.document.id).toBe(docId(first));
    expect(ctx?.state.activeId).toBe(bootstrapSessionId);
  });

  it('still opens a genuinely different file in its own tab', async () => {
    const first = docJson('DesignFile1');
    const second = docJson('Other');
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={first}
        initialDocumentName="DesignFile1"
        initialFileId="file-1"
      >
        <Harness
          onReady={(c) => {
            ctx = c;
          }}
        />
      </EditorProvider>,
    );
    await waitFor(() => expect(ctx).toBeDefined());

    act(() => {
      ctx?.openFile('file-2', 'Other', undefined, second);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions).toHaveLength(2);
    expect(ctx?.state.sessions.map((s) => s.name)).toEqual(['DesignFile1', 'Other']);
    expect(ctx?.state.sessions.map((s) => s.fileId)).toEqual(['file-1', 'file-2']);
    // The new tab is active and holds the second document, not a blank canvas
    // standing in for a payload that never decoded.
    expect(ctx?.state.document.id).toBe(docId(second));
    expect(ctx?.state.activeId).toBe(ctx?.state.sessions[1]?.id);
  });
});
