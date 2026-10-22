// @vitest-environment jsdom

/**
 * The status bar must tell the user when autosave has stopped protecting them.
 *
 * Before this, a failed recovery write produced only a console-level signal:
 * the calculated/loaded indicator looked healthy while the safety net was gone.
 */
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecoveryStatusForTests, setRecoveryStatus } from '../../persistence/recoveryStatus';
import { SaveStatusIndicator } from './SaveStatusIndicator';

vi.mock('../../context', () => ({
  useEditor: () => ({
    state: {
      activeId: 'session-0',
      sessions: [{ id: 'session-0', name: 'Poster', fileId: 'f1', libraryStorage: true }],
      dirty: false,
      saveState: 'saved',
      saveIssue: null,
      lastSavedAt: Date.now(),
    },
    setShowDocumentInfo: () => undefined,
  }),
}));

describe('SaveStatusIndicator — recovery failure', () => {
  beforeEach(() => resetRecoveryStatusForTests());
  afterEach(() => resetRecoveryStatusForTests());

  it('is silent while autosave is healthy', () => {
    render(<SaveStatusIndicator />);
    expect(screen.queryByText(/Recovery paused/)).toBeNull();
  });

  it('shows and clears a persistent recovery warning', () => {
    render(<SaveStatusIndicator />);

    act(() => setRecoveryStatus('failing'));
    // role="status" is a live region: its content is announced when it appears,
    // so the name comes from the content rather than an aria-label.
    const warning = screen.getByText(/Recovery paused/);
    expect(warning.closest('[role="status"]')).not.toBeNull();
    // The visible label alone does not say what happened or what to do.
    expect(warning.textContent).toContain('autosave could not write a recovery copy');

    act(() => setRecoveryStatus('ok'));
    expect(screen.queryByText(/Recovery paused/)).toBeNull();
  });
});
