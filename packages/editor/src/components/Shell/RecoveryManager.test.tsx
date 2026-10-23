// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEAN_SHUTDOWN_KEY, resetSharedShutdownMarker } from '../../lifecycle/lifecycleMarker';

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => true),
  readNativePreviousCleanShutdown: vi.fn<() => Promise<boolean | null>>(),
  hasSessions: vi.fn<() => Promise<boolean>>(),
  listSessions: vi.fn<() => Promise<Array<{ id: string; tabName: string; timestamp: number }>>>(),
  deleteSession: vi.fn<(id: string) => Promise<void>>(),
  restoreSession:
    vi.fn<
      (id: string) => Promise<{
        document: unknown;
        tabName: string;
      } | null>
    >(),
  loadDocument: vi.fn<(json: string, meta?: unknown) => boolean>(),
}));

vi.mock('@varve/platform', () => ({
  isTauriRuntime: mocks.isTauriRuntime,
  readNativePreviousCleanShutdown: mocks.readNativePreviousCleanShutdown,
}));

vi.mock('../../context', () => ({ useEditor: () => ({ loadDocument: mocks.loadDocument }) }));

vi.mock('../../recovery', () => ({
  getSharedRecoveryManager: () => ({
    hasSessions: mocks.hasSessions,
    listSessions: mocks.listSessions,
    deleteSession: mocks.deleteSession,
    restoreSession: mocks.restoreSession,
  }),
}));

vi.mock('../RecoveryDialog', () => ({
  RecoveryDialog: ({
    open,
    sessions,
    onRestore,
  }: {
    open: boolean;
    sessions: Array<{ id: string }>;
    onRestore: (id: string) => void;
  }) => (
    <div data-testid="recovery-dialog" data-open={String(open)} data-count={sessions.length}>
      {sessions.map((session) => (
        <button key={session.id} type="button" onClick={() => onRestore(session.id)}>
          Restore
        </button>
      ))}
    </div>
  ),
}));

import { RecoveryManager } from './RecoveryManager';

const sessions = [{ id: 'recovery-1', tabName: 'Poster', timestamp: 1 }];

describe('RecoveryManager native shutdown classification', () => {
  beforeEach(() => {
    resetSharedShutdownMarker();
    localStorage.setItem(CLEAN_SHUTDOWN_KEY, 'true');
    mocks.isTauriRuntime.mockReturnValue(true);
    mocks.readNativePreviousCleanShutdown.mockResolvedValue(false);
    mocks.hasSessions.mockResolvedValue(true);
    mocks.listSessions.mockResolvedValue(sessions);
    mocks.deleteSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    resetSharedShutdownMarker();
    localStorage.removeItem(CLEAN_SHUTDOWN_KEY);
    vi.clearAllMocks();
  });

  it('shows recoverable work when native SQLite reports an interrupted exit, even if WebKit says clean', async () => {
    render(<RecoveryManager />);

    await waitFor(() =>
      expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'true'),
    );
    expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-count', '1');
    expect(mocks.readNativePreviousCleanShutdown).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('silently removes stale recovery data only after a native clean exit', async () => {
    mocks.readNativePreviousCleanShutdown.mockResolvedValue(true);
    render(<RecoveryManager />);

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('recovery-1'));
    expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'false');
  });

  it('uses the prior WebView marker when upgrading from a release without native shutdown state', async () => {
    mocks.readNativePreviousCleanShutdown.mockResolvedValue(null);
    render(<RecoveryManager />);

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('recovery-1'));
    expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'false');
  });

  it('preserves recovery sessions when native shutdown state is unavailable', async () => {
    mocks.readNativePreviousCleanShutdown.mockRejectedValue(
      new Error('native database unavailable'),
    );
    render(<RecoveryManager />);

    await waitFor(() =>
      expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'false'),
    );
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('continues using the browser marker outside Tauri', async () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    localStorage.setItem(CLEAN_SHUTDOWN_KEY, 'false');
    render(<RecoveryManager />);

    await waitFor(() =>
      expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'true'),
    );
    expect(mocks.readNativePreviousCleanShutdown).not.toHaveBeenCalled();
  });

  it('keeps an unreadable recovery snapshot instead of deleting the only copy', async () => {
    // restoreSession() parses and migrates but does not validate required
    // collections, so a snapshot can reach loadDocument and still be refused.
    // Deleting it then would turn a reported failure into permanent loss.
    mocks.restoreSession.mockResolvedValue({ document: { broken: true }, tabName: 'Poster' });
    mocks.loadDocument.mockReturnValue(false);
    render(<RecoveryManager />);

    await waitFor(() =>
      expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledOnce());
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('removes the recovery snapshot after a successful restore', async () => {
    mocks.restoreSession.mockResolvedValue({ document: { id: 'doc-1' }, tabName: 'Poster' });
    mocks.loadDocument.mockReturnValue(true);
    render(<RecoveryManager />);

    await waitFor(() =>
      expect(screen.getByTestId('recovery-dialog')).toHaveAttribute('data-open', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('recovery-1'));
  });
});
