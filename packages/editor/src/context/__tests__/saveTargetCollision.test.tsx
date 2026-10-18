import { act, render } from '@testing-library/react';
import { createMemoryPlatform, type WriteSaveResult } from '@varve/platform';
import { createDocument, DocumentCodec } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

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
