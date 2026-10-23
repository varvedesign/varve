// @vitest-environment jsdom

/**
 * Opening a file that cannot be decoded must not replace the current document.
 *
 * Before this, `openFile` fell back to `createDocument(name)` — a blank
 * document under the requested file's name. The canvas looked like the file
 * had opened, and the next save wrote over the real document. `loadDocument`
 * swallowed invalid JSON entirely, so the click appeared to do nothing.
 *
 * External evidence: vectorcraft#861 ("opening does nothing: no document
 * appears and no error is shown"), #1151, #2177.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryPlatform, type Platform } from '@varve/platform';
import { createDocument, DocumentCodec } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, setToastHandler, useEditor } from '../../context';

type Editor = ReturnType<typeof useEditor>;

async function mount(): Promise<{
  read: () => Editor;
  toasts: Array<{ message: string; description?: string; type?: string }>;
}> {
  const platform = createMemoryPlatform();
  const toasts: Array<{ message: string; description?: string; type?: string }> = [];
  setToastHandler((toast) => toasts.push(toast));

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
  return {
    read: () => {
      if (!editor) throw new Error('editor context was unmounted');
      return editor;
    },
    toasts,
  };
}

afterEach(() => setToastHandler(null));

describe('openFile with an unreadable document', () => {
  it('keeps the current document and reports why', async () => {
    const { read, toasts } = await mount();
    const before = read().state.document;

    act(() => {
      read().openFile(undefined, 'Broken.varve', '/tmp/Broken.varve', '{ not json');
    });

    expect(read().state.document).toBe(before);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain('Broken.varve');
    expect(toasts[0]?.type).toBe('error');
    expect(toasts[0]?.description).toMatch(/Nothing was changed/i);
  });

  it('keeps the document when the JSON decodes to nothing usable', async () => {
    const { read, toasts } = await mount();
    const before = read().state.document;

    act(() => {
      read().openFile(undefined, 'Empty.varve', '/tmp/Empty.varve', '{"version":1}');
    });

    expect(read().state.document).toBe(before);
    expect(toasts).toHaveLength(1);
  });

  it.each([
    ['an empty payload', 'Zero.varve', ''],
    ['a whitespace-only payload', 'Blank.varve', '  \n\t '],
  ])('refuses %s instead of opening a blank tab', async (_label, name, payload) => {
    // A zero-byte file is what the picker hands over for a truncated download,
    // an interrupted write, or a file the user emptied by accident. `openFile`
    // used to treat any falsy payload as "new document", so the empty string
    // skipped the decode guard entirely: the tab was rebound to the file's
    // name while holding a blank canvas, and the next save overwrote whatever
    // the real file still had. Only `null` may request a new document.
    const { read, toasts } = await mount();
    const before = read().state.document;
    const sessionsBefore = read().state.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      fileId: s.fileId,
      filePath: s.filePath,
    }));

    act(() => {
      read().openFile(undefined, name, `/tmp/${name}`, payload);
    });

    expect(read().state.document).toBe(before);
    expect(
      read().state.sessions.map((s) => ({
        id: s.id,
        name: s.name,
        fileId: s.fileId,
        filePath: s.filePath,
      })),
    ).toEqual(sessionsBefore);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain(name);
    expect(toasts[0]?.type).toBe('error');
    expect(toasts[0]?.description).toMatch(/Nothing was changed/i);
  });

  it('refuses an empty payload through loadDocument too', async () => {
    // `loadDocument` is a separate public entry point (used by recovery and
    // host integrations), so the same contract is pinned here rather than
    // assumed to follow from openFile.
    const { read, toasts } = await mount();
    const before = read().state.document;

    let accepted: boolean | undefined;
    act(() => {
      accepted = read().loadDocument('', { name: 'Gone.varve' });
    });

    expect(accepted).toBe(false);
    expect(read().state.document).toBe(before);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toContain('Gone.varve');
    expect(toasts[0]?.type).toBe('error');
  });

  it('still creates a blank document when the caller asks for a new one', async () => {
    const { read, toasts } = await mount();
    const before = read().state.document;

    act(() => {
      read().openFile(undefined, 'Untitled', undefined, null);
    });

    expect(read().state.document).not.toBe(before);
    expect(toasts).toHaveLength(0);
  });

  it('opens a valid document', async () => {
    const { read, toasts } = await mount();
    const valid = DocumentCodec.encode(createDocument('Valid'));

    act(() => {
      read().openFile(undefined, 'Valid.varve', '/tmp/Valid.varve', valid);
    });

    expect(read().state.document.name).toBe('Valid');
    expect(toasts).toHaveLength(0);
  });
});
