// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDocument, type Document } from '@varve/scene';
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
        document: Document;
        tabName: string;
        recordedFileId?: string;
        recordedFilePath?: string;
      } | null>
    >(),
  loadDocument: vi.fn<(json: string, meta: { name: string; newSession: boolean }) => boolean>(),
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
    onRestoreAll,
  }: {
    open: boolean;
    sessions: { id: string }[];
    onRestore: (id: string) => void;
    onRestoreAll: () => void;
  }) => (
    <div data-testid="recovery-dialog" data-open={String(open)} data-count={sessions.length}>
      {sessions.map((session) => (
        <button type="button" key={session.id} onClick={() => onRestore(session.id)}>
          Restore {session.id}
        </button>
      ))}
      <button type="button" onClick={onRestoreAll}>
        Restore all
      </button>
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
    mocks.loadDocument.mockReturnValue(true);
    mocks.restoreSession.mockResolvedValue({
      document: createDocument('Recovered'),
      tabName: 'Poster',
      recordedFileId: 'untrusted-id',
      recordedFilePath: '/untrusted/overwrite.varve',
    });
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

  it('opens without a save destination and deletes the snapshot only after a successful load', async () => {
    render(<RecoveryManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore recovery-1' }));
    await waitFor(() => expect(mocks.deleteSession).toHaveBeenCalledWith('recovery-1'));
    expect(mocks.loadDocument).toHaveBeenCalledWith(expect.any(String), {
      name: 'Poster',
      newSession: true,
    });
  });

  it('retains the only recovery copy when loading fails', async () => {
    mocks.loadDocument.mockReturnValue(false);
    render(<RecoveryManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore recovery-1' }));
    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledOnce());
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('bulk restore deletes only successful loads, retaining rejected and unreadable snapshots', async () => {
    mocks.listSessions.mockResolvedValue([
      ...sessions,
      { id: 'recovery-2', tabName: 'Rejected', timestamp: 2 },
      { id: 'recovery-3', tabName: 'Unreadable', timestamp: 3 },
    ]);
    mocks.restoreSession.mockImplementation(async (id) =>
      id === 'recovery-3'
        ? null
        : {
            document: createDocument(id),
            tabName: id,
          },
    );
    mocks.loadDocument.mockImplementation((_json, meta) => meta.name !== 'recovery-2');
    render(<RecoveryManager />);
    await screen.findByRole('button', { name: 'Restore recovery-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    await waitFor(() => expect(mocks.restoreSession).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(mocks.loadDocument).toHaveBeenCalledTimes(2));
    expect(mocks.deleteSession.mock.calls).toEqual([['recovery-1']]);
  });
});
