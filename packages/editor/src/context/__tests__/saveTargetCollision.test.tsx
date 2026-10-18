import { act, render, waitFor } from '@testing-library/react';
import { createMemoryPlatform, type WriteSaveResult } from '@varve/platform';
import { createDocument, DocumentCodec } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { getSharedRecoveryManager } from '../../recovery';

afterEach(() => {
  vi.restoreAllMocks();
});

function mountEditor() {
  const platform = createMemoryPlatform();
  platform.chooseDocumentSaveTarget = vi.fn(async () => ({
    kind: 'target' as const,
    target: { kind: 'native-file' as const, path: '/docs/alias.varve' },
  }));
  platform.writeSaveTarget = vi.fn(async (): Promise<WriteSaveResult> => ({ kind: 'written' }));
  // The platform adapter owns OS-specific identity checks. This models two
  // different path strings that resolve to one underlying file.
  platform.sameNativeFile = vi.fn(async () => true);

  let editor: ReturnType<typeof useEditor> | undefined;
  function TestComponent() {
    editor = useEditor();
    return null;
  }
  render(
    <EditorProvider
      platform={platform}
      initialDocumentName="Open file"
      initialFileId="file-a"
      initialFilePath="/docs/original.varve"
    >
      <TestComponent />
    </EditorProvider>,
  );
  return {
    platform,
    getEditor() {
      if (!editor) throw new Error('editor context not mounted');
      return editor;
    },
  };
}

describe('save destination ownership', () => {
  it('keeps a concurrent edit in the saved session when switching tabs during a write', async () => {
    const { platform, getEditor } = mountEditor();
    platform.readDocumentText = vi.fn(async () => ({ ok: true as const, text: '{}' }));
    let finishWrite!: (result: WriteSaveResult) => void;
    platform.writeSaveTarget = vi.fn(
      () =>
        new Promise<WriteSaveResult>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const originalId = getEditor().state.activeId;
    const deleteRecovery = vi.spyOn(getSharedRecoveryManager(), 'deleteSession');
    act(() => {
      getEditor().setTool('rect');
      getEditor().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = getEditor().save();
    });
    await waitFor(() => expect(platform.writeSaveTarget).toHaveBeenCalledOnce());
    act(() => {
      getEditor().createShapeAt({ x: 30, y: 30 }, { w: 40, h: 40 });
    });
    act(() => getEditor().newDocument());
    const newId = getEditor().state.activeId;
    finishWrite({ kind: 'written' });
    await act(async () => savePromise);

    expect(getEditor().state.activeId).toBe(newId);
    expect(getEditor().state.dirty).toBe(false);
    expect(getEditor().state.sessions.find((session) => session.id === originalId)).toMatchObject({
      dirty: true,
    });
    expect(deleteRecovery).not.toHaveBeenCalled();
  });

  it('recreates recovery if an edit arrives while Save As deletes the old recovery point', async () => {
    const { platform, getEditor } = mountEditor();
    let finishDelete!: () => void;
    const recovery = getSharedRecoveryManager();
    const deleteRecovery = vi.spyOn(recovery, 'deleteSession').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );
    const createRecovery = vi.spyOn(recovery, 'createRecoveryPoint').mockResolvedValue();
    act(() => {
      getEditor().setTool('rect');
      getEditor().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = getEditor().saveAs();
    });
    await waitFor(() => expect(deleteRecovery).toHaveBeenCalledOnce());
    act(() => {
      getEditor().createShapeAt({ x: 30, y: 30 }, { w: 40, h: 40 });
    });
    const latestOriginalRevision = getEditor().state.document;
    act(() => getEditor().newDocument());
    finishDelete();
    await act(async () => savePromise);

    expect(createRecovery).toHaveBeenCalled();
    expect(createRecovery.mock.calls.at(-1)?.[0]).toBe(latestOriginalRevision);
    expect(getEditor().state.dirty).toBe(false);
    expect(getEditor().state.sessions.find((session) => session.fileId === 'file-a')).toMatchObject(
      {
        dirty: true,
      },
    );
    expect(platform.writeSaveTarget).toHaveBeenCalledOnce();
  });

  it('recreates the latest recovery after editing and switching tabs during recovery deletion', async () => {
    const { platform, getEditor } = mountEditor();
    let finishDelete!: () => void;
    const recovery = getSharedRecoveryManager();
    const deleteRecovery = vi.spyOn(recovery, 'deleteSession').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );
    const createRecovery = vi.spyOn(recovery, 'createRecoveryPoint').mockResolvedValue();

    act(() => {
      getEditor().setTool('rect');
      getEditor().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = getEditor().saveAs();
    });
    await waitFor(() => expect(deleteRecovery).toHaveBeenCalledOnce());
    act(() => {
      getEditor().createShapeAt({ x: 30, y: 30 }, { w: 40, h: 40 });
    });
    const latestOriginalRevision = getEditor().state.document;
    act(() => getEditor().newDocument());
    finishDelete();
    await act(async () => savePromise);

    expect(createRecovery).toHaveBeenCalledOnce();
    expect(createRecovery.mock.calls[0]?.[0]).toBe(latestOriginalRevision);
    expect(getEditor().state.sessions.find((session) => session.fileId === 'file-a')).toMatchObject(
      {
        dirty: true,
      },
    );
    expect(platform.writeSaveTarget).toHaveBeenCalledOnce();
  });

  it('keeps recovery for edits made while Save As mirrors the saved revision', async () => {
    const platform = createMemoryPlatform();
    platform.chooseDocumentSaveTarget = vi.fn(async () => ({
      kind: 'target' as const,
      target: { kind: 'download-only' as const, suggestedName: 'Untitled.varve' },
    }));
    platform.writeSaveTarget = vi.fn(async (): Promise<WriteSaveResult> => ({ kind: 'written' }));
    let finishMirror!: () => void;
    platform.upsertFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishMirror = resolve;
        }),
    );
    const deleteRecovery = vi.spyOn(getSharedRecoveryManager(), 'deleteSession');

    let editor: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider platform={platform} initialFileId="existing-file">
        <TestComponent />
      </EditorProvider>,
    );
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = editor!.saveAs();
    });
    await waitFor(() => expect(platform.upsertFile).toHaveBeenCalledOnce());
    act(() => {
      editor!.createShapeAt({ x: 30, y: 30 }, { w: 40, h: 40 });
    });
    finishMirror();
    await act(async () => savePromise);

    expect(deleteRecovery).not.toHaveBeenCalled();
    expect(editor!.state.dirty).toBe(true);
  });

  it('applies an in-flight Save As to its original session after switching documents', async () => {
    const platform = createMemoryPlatform();
    platform.chooseDocumentSaveTarget = vi.fn(async () => ({
      kind: 'target' as const,
      target: { kind: 'native-file' as const, path: '/docs/Original.varve' },
    }));
    platform.writeSaveTarget = vi.fn(async (): Promise<WriteSaveResult> => ({ kind: 'written' }));
    let finishMirror!: () => void;
    platform.upsertFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishMirror = resolve;
        }),
    );
    const deleteRecovery = vi.spyOn(getSharedRecoveryManager(), 'deleteSession');

    let editor: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider platform={platform} initialFileId="original-file">
        <TestComponent />
      </EditorProvider>,
    );
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    const originalId = editor!.state.activeId;
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = editor!.saveAs();
    });
    await waitFor(() => expect(platform.upsertFile).toHaveBeenCalledOnce());
    act(() => editor!.newDocument());
    const newId = editor!.state.activeId;
    expect(newId).not.toBe(originalId);
    finishMirror();
    await act(async () => savePromise);

    expect(editor!.state.activeId).toBe(newId);
    expect(editor!.state.dirty).toBe(false);
    expect(editor!.state.sessions.find((session) => session.id === originalId)).toMatchObject({
      fileId: 'original-file',
      filePath: '/docs/Original.varve',
      dirty: false,
    });
    expect(deleteRecovery).toHaveBeenCalledOnce();
    expect(editor!.state.sessions.find((session) => session.id === newId)).not.toHaveProperty(
      'downloadName',
    );
  });

  it('keeps a download-only Save As dirty because it has no persistent destination', async () => {
    const platform = createMemoryPlatform();
    platform.chooseDocumentSaveTarget = vi.fn(async () => ({
      kind: 'target' as const,
      target: { kind: 'download-only' as const, suggestedName: 'Untitled.varve' },
    }));
    platform.writeSaveTarget = vi.fn(async (): Promise<WriteSaveResult> => ({ kind: 'written' }));
    platform.upsertFile = vi.fn(async () => {
      throw new Error('mirror quota exceeded');
    });
    const deleteRecovery = vi.spyOn(getSharedRecoveryManager(), 'deleteSession');

    let editor: ReturnType<typeof useEditor> | undefined;
    function TestComponent() {
      editor = useEditor();
      return null;
    }
    render(
      <EditorProvider platform={platform} initialFileId="existing-file">
        <TestComponent />
      </EditorProvider>,
    );
    await waitFor(() => expect(editor?.persistentHistory.attached).toBe(true));
    act(() => {
      editor!.setTool('rect');
      editor!.createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(editor?.state.dirty).toBe(true));

    await act(async () => {
      await editor!.saveAs();
    });

    expect(platform.writeSaveTarget).toHaveBeenCalledOnce();
    expect(platform.upsertFile).toHaveBeenCalledOnce();
    expect(deleteRecovery).not.toHaveBeenCalled();
    expect(editor!.state.dirty).toBe(true);
    expect(editor!.state.saveState).toBe('idle');
    expect(editor!.state.sessions[0]).toMatchObject({
      dirty: true,
      downloadName: 'Untitled.varve',
    });
  });

  it.each([
    ['Save As', 'saveAs'],
    ['Save a Copy', 'saveCopy'],
  ] as const)('%s does not overwrite a file owned by another open tab', async (_label, action) => {
    const { platform, getEditor } = mountEditor();
    act(() => {
      getEditor().newDocument();
    });

    await act(async () => {
      await getEditor()[action]();
    });

    expect(platform.sameNativeFile).toHaveBeenCalledWith(
      '/docs/alias.varve',
      '/docs/original.varve',
    );
    expect(platform.writeSaveTarget).not.toHaveBeenCalled();
    expect(getEditor().state.saveIssue).toMatchObject({
      category: 'destination-in-use',
    });
    expect(getEditor().state.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: 'file-a', filePath: '/docs/original.varve' }),
      ]),
    );
  });

  it('checks Save As ownership again after the destination picker returns', async () => {
    const { platform, getEditor } = mountEditor();
    let finishPicker!: (choice: {
      kind: 'target';
      target: { kind: 'native-file'; path: string };
    }) => void;
    platform.chooseDocumentSaveTarget = vi.fn(
      () =>
        new Promise((resolve) => {
          finishPicker = resolve;
        }),
    );
    act(() => {
      getEditor().setTool('rect');
      getEditor().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });

    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = getEditor().saveAs();
    });
    await waitFor(() => expect(platform.chooseDocumentSaveTarget).toHaveBeenCalledOnce());

    act(() => {
      getEditor().loadDocument(DocumentCodec.encode(createDocument('Alias')), {
        fileId: 'file-b',
        filePath: '/docs/alias.varve',
        newSession: true,
      });
    });
    finishPicker({ kind: 'target', target: { kind: 'native-file', path: '/docs/alias.varve' } });
    await act(async () => savePromise);

    expect(platform.sameNativeFile).toHaveBeenCalledWith('/docs/alias.varve', '/docs/alias.varve');
    expect(platform.writeSaveTarget).not.toHaveBeenCalled();
  });

  it('Save refuses a native target owned by another open tab', async () => {
    const { platform, getEditor } = mountEditor();
    act(() => {
      getEditor().loadDocument(DocumentCodec.encode(createDocument('Alias')), {
        fileId: 'file-b',
        filePath: '/docs/alias.varve',
        newSession: true,
      });
    });

    await act(async () => {
      await getEditor().save();
    });

    expect(platform.sameNativeFile).toHaveBeenCalledWith(
      '/docs/alias.varve',
      '/docs/original.varve',
    );
    expect(platform.writeSaveTarget).not.toHaveBeenCalled();
    expect(getEditor().state.saveIssue).toMatchObject({
      category: 'destination-in-use',
    });
  });
});
