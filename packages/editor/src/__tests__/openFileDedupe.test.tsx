import { act, render, waitFor } from '@testing-library/react';
import { createDocument, DocumentCodec } from '@varve/scene';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, setToastHandler, useEditor } from '../context';

/**
 * The host hands the same open request to the provider twice: once as
 * `initialDocumentJson`, which becomes the bootstrap session, and once via
 * `openFile`. The bootstrap session used to carry no file identity, so
 * `openFile`'s dedupe — which matches on file id or path — could not recognise
 * it and opened the same document a second time, leaving two tabs on one file.
 */
function docJson(name: string) {
  return DocumentCodec.encode(createDocument(name));
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
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={docJson('DesignFile1')}
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

    // The host's openFile dispatch for the very file already bootstrapped.
    ctx?.openFile('file-1', 'DesignFile1', undefined, docJson('DesignFile1'));
    // Settle the state update before asserting — a waitFor on the count can
    // observe the pre-update value and pass while a duplicate is being added.
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions.map((s) => s.name)).toEqual(['DesignFile1']);
    expect(ctx?.state.sessions[0]?.fileId).toBe('file-1');
  });

  it('still opens a genuinely different file in its own tab', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson={docJson('DesignFile1')}
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

    ctx?.openFile('file-2', 'Other', undefined, docJson('Other'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx?.state.sessions).toHaveLength(2);
  });

  it('refuses a corrupt document without opening a blank tab bound to its path', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    const toast = vi.fn();
    setToastHandler(toast);
    try {
      render(
        <EditorProvider
          initialDocumentJson={docJson('DesignFile1')}
          initialDocumentName="DesignFile1"
          initialFileId="file-1"
          initialFilePath="/docs/design-1.varve"
        >
          <Harness
            onReady={(c) => {
              ctx = c;
            }}
          />
        </EditorProvider>,
      );
      await waitFor(() => expect(ctx).toBeDefined());

      const corrupt =
        '{"id":"doc-bad","name":"Broken","rootChildren":[],"nodes":{},"components":{},"nextId":1e309}';
      ctx?.openFile('file-bad', 'Broken.varve', '/docs/broken.varve', corrupt);
      await act(async () => {
        await Promise.resolve();
      });

      expect(ctx?.state.sessions).toHaveLength(1);
      expect(ctx?.state.sessions[0]?.name).toBe('DesignFile1');
      expect(ctx?.state.sessions[0]?.fileId).toBe('file-1');
      expect(ctx?.state.sessions[0]?.filePath).toBe('/docs/design-1.varve');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('nextId'),
        }),
      );
    } finally {
      setToastHandler(null);
    }
  });

  it('does not bind bootstrap fallback state to an undecodable source file', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;
    render(
      <EditorProvider
        initialDocumentJson='{"id":"doc-bad","name":"Broken","rootChildren":[],"nodes":{},"components":{},"nextId":1e309}'
        initialDocumentName="Broken.varve"
        initialFileId="file-bad"
        initialFilePath="/docs/broken.varve"
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
    expect(ctx?.state.sessions[0]?.fileId).toBeUndefined();
    expect(ctx?.state.sessions[0]?.filePath).toBeUndefined();
  });
});
