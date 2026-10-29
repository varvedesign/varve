// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import type { Platform } from '@varve/platform';
import { createMemoryPlatform } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

describe('download-only document saves', () => {
  it('does not report a download as saved for Save, Save As, or Save a Copy', async () => {
    const platform = createMemoryPlatform();
    vi.spyOn(platform, 'chooseDocumentSaveTarget').mockResolvedValue({
      kind: 'target',
      target: { kind: 'download-only', suggestedName: 'Untitled.varve' },
    });
    vi.spyOn(platform, 'writeSaveTarget').mockResolvedValue({ kind: 'written' });

    let editor: ReturnType<typeof useEditor> | undefined;
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

    act(() => editor?.setDocumentBlendEvaluationSpace('linear-srgb'));
    await waitFor(() => expect(editor?.state.dirty).toBe(true));

    let saved = false;
    await act(async () => {
      saved = await editor!.save();
    });

    expect(saved).toBe(false);
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.sessions[0]?.dirty).toBe(true);
    expect(editor.state.sessions[0]?.downloadName).toBe('Untitled.varve');
    expect(editor.state.saveState).toBe('idle');
    expect(editor.state.lastSavedAt).toBeNull();

    let savedAs = true;
    await act(async () => {
      savedAs = await editor!.saveAs();
    });
    expect(savedAs).toBe(false);
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.saveState).toBe('idle');
    expect(editor.state.lastSavedAt).toBeNull();

    let savedCopy = true;
    await act(async () => {
      savedCopy = await editor!.saveCopy();
    });
    expect(savedCopy).toBe(false);
    expect(editor.state.dirty).toBe(true);

    await act(async () => {
      saved = await editor!.save();
    });
    expect(saved).toBe(false);
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.lastSavedAt).toBeNull();
  });
});
