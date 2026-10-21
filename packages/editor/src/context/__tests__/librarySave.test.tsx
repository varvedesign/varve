// @vitest-environment jsdom

/**
 * Regression: a failed Varve Library save keeps the document dirty.
 *
 * This drives the real editor save path, not only the helper, so reverting the
 * app-storage branch to the swallow-everything `mirror()` fails here: the
 * document would be marked clean, the recovery point dropped, and the failure
 * hidden.
 *
 * External evidence: vectorcraft#1693 (a save whose write could not be
 * confirmed still marked the document clean and let it close) and #1685 (the
 * failure was not shown to the user).
 */
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryPlatform, type Platform } from '@varve/platform';
import { createDocument, DocumentCodec } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

type Editor = ReturnType<typeof useEditor>;

async function mountLibraryDocument(rejectWrite: boolean): Promise<{
  read: () => Editor;
  platform: Platform & { upsertFile: ReturnType<typeof vi.fn> };
}> {
  const platform = createMemoryPlatform();
  const json = DocumentCodec.encode(createDocument('Lib'));
  if (rejectWrite) {
    vi.spyOn(platform, 'upsertFile').mockRejectedValue(new Error('indexeddb unavailable'));
  }

  let editor: Editor | undefined;
  function Capture() {
    editor = useEditor();
    return null;
  }

  render(
    <EditorProvider platform={platform as Platform}>
      <Capture />
    </EditorProvider>,
  );
  await waitFor(() => expect(editor).toBeDefined());
  if (!editor) throw new Error('editor context was not mounted');

  await act(async () => {
    editor!.loadDocument(json, {
      fileId: 'library-1',
      name: 'Lib',
      libraryStorage: true,
    });
  });
  await waitFor(() => expect(editor?.state.sessions[0]?.libraryStorage).toBe(true));

  // Make the document dirty without changing its destination.
  act(() => editor?.setDocumentBlendEvaluationSpace('linear-srgb'));
  await waitFor(() => expect(editor?.state.dirty).toBe(true));

  return {
    // Always read the latest render's state; a captured object goes stale.
    read: () => {
      if (!editor) throw new Error('editor context was unmounted');
      return editor;
    },
    platform: platform as Platform & { upsertFile: ReturnType<typeof vi.fn> },
  };
}

describe('Varve Library saves', () => {
  it('reports failure and stays dirty when the library write rejects', async () => {
    const { read, platform } = await mountLibraryDocument(true);

    let saved = true;
    await act(async () => {
      saved = await read().save();
    });

    expect(saved).toBe(false);
    expect(platform.upsertFile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(read().state.saveState).toBe('error'));
    const state = read().state;
    expect(state.dirty).toBe(true);
    expect(state.sessions[0]?.dirty).toBe(true);
    expect(state.saveIssue?.message).toContain('still unsaved');
    expect(state.lastSavedAt).toBeNull();
  });

  it('commits the save when the library write succeeds', async () => {
    const { read } = await mountLibraryDocument(false);

    let saved = false;
    await act(async () => {
      saved = await read().save();
    });

    expect(saved).toBe(true);
    await waitFor(() => expect(read().state.dirty).toBe(false));
    const state = read().state;
    expect(state.saveState).toBe('saved');
    expect(state.saveIssue).toBeNull();
    expect(state.lastSavedAt).not.toBeNull();
  });
});
