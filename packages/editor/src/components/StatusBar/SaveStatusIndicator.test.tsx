import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The indicator only reads a few fields of the editor state; a stub keeps this
// test about the label logic instead of the whole provider.
const editor = {
  state: {
    saveState: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
    saveIssue: null as { message: string } | null,
    lastSavedAt: null as number | null,
    dirty: false,
    activeId: 's1',
    sessions: [] as Array<Record<string, unknown>>,
  },
  setShowDocumentInfo: vi.fn(),
};
vi.mock('../../context', () => ({ useEditor: () => editor }));

import { SaveStatusIndicator } from './SaveStatusIndicator';

function setSession(extra: Record<string, unknown> = {}, dirty = false) {
  editor.state.sessions = [{ id: 's1', name: 'NewDesign1', dirty, ...extra }];
}

const label = () => screen.getByRole('button', { name: /open Document Info/ });

describe('SaveStatusIndicator', () => {
  beforeEach(() => {
    editor.state.saveState = 'idle';
    editor.state.saveIssue = null;
    editor.state.lastSavedAt = null;
    editor.state.dirty = false;
    setSession();
  });

  it('says "Not saved" only for a document with no save destination', () => {
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Not saved');
  });

  it('says "Saved" for an unchanged document that has a destination, even before a save this session', () => {
    // Opened from a file: saveState is still 'idle' because nothing was written
    // this session, but the document matches its file. It used to read
    // "Not saved".
    setSession({ filePath: '/home/me/poster.varve' });
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Saved');
  });

  it('treats explicit library storage and a browser file handle as destinations', () => {
    setSession({ libraryStorage: true, fileId: 'f1' });
    const { unmount } = render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Saved');
    unmount();

    setSession({ saveHandleId: 'h1' });
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Saved');
  });

  it('does not count a bare library id as a destination', () => {
    setSession({ fileId: 'minted-at-creation' });
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Not saved');
  });

  it('prefers Modified for an edited document, with or without a destination', () => {
    editor.state.dirty = true;
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Modified');
  });

  it('keeps Saving and Save failed ahead of everything else', () => {
    setSession({ filePath: '/p.varve' });
    editor.state.saveState = 'saving';
    const { unmount } = render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Saving');
    unmount();
    editor.state.saveState = 'error';
    editor.state.saveIssue = { message: 'Disk full' };
    render(<SaveStatusIndicator />);
    expect(label()).toHaveTextContent('Save failed');
  });
});
