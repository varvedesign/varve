import { act, renderHook, waitFor } from '@testing-library/react';
import { createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorHistorySession } from '../history/editorHistorySession';
import { usePersistentHistory } from './usePersistentHistory';

describe('persistent history session isolation', () => {
  it('uses session history when IndexedDB denies access during attach', async () => {
    const document = createDocument('Private browser', true);
    const originalAttach = EditorHistorySession.prototype.attach;
    let attempts = 0;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, current) {
        attempts++;
        if (attempts === 1) throw new DOMException('Storage blocked', 'SecurityError');
        return originalAttach.call(this, current);
      });
    try {
      const { result } = renderHook(() =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef: { current: false },
          historySkipRef: { current: false },
        }),
      );
      await waitFor(() => expect(result.current.attached).toBe(true));
      expect(attempts).toBe(2);
      expect(result.current.session?.attached).toBe(true);
      expect(result.current.attachIssues).toEqual([]);
    } finally {
      attach.mockRestore();
    }
  });

  it('retains an edit made while persistent history is attaching', async () => {
    const first = createDocument('Before', true);
    const edited = { ...first, name: 'Edited during attach' };
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const originalAttach = EditorHistorySession.prototype.attach;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, document) {
        await pending;
        return originalAttach.call(this, document);
      });
    const inTransactionRef = { current: false };
    const historySkipRef = { current: false };
    const { result, rerender } = renderHook(
      ({ document }) =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef,
          historySkipRef,
        }),
      { initialProps: { document: first } },
    );
    try {
      await waitFor(() => expect(attach).toHaveBeenCalledOnce());
      rerender({ document: edited });
      await act(async () => {
        finish();
        await pending;
      });
      await waitFor(() => expect(result.current.attached).toBe(true));
      await waitFor(async () => expect(await result.current.steps()).toHaveLength(2));
      const undo = await result.current.session!.undo();
      expect(undo!.document.name).toBe('Before');
    } finally {
      attach.mockRestore();
    }
  });

  it('does not capture a previous document into the next session after a late attach', async () => {
    const first = createDocument('First', true);
    const edited = { ...first, name: 'Edited while attaching' };
    const second = createDocument('Second', true);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const originalAttach = EditorHistorySession.prototype.attach;
    const attach = vi
      .spyOn(EditorHistorySession.prototype, 'attach')
      .mockImplementation(async function (this: EditorHistorySession, document) {
        if (document.id === first.id) await pending;
        return originalAttach.call(this, document);
      });
    const capture = vi.spyOn(EditorHistorySession.prototype, 'capture');
    const inTransactionRef = { current: false };
    const historySkipRef = { current: false };
    const { result, rerender } = renderHook(
      ({ document }) =>
        usePersistentHistory({
          document,
          selection: [],
          patch: vi.fn(),
          inTransactionRef,
          historySkipRef,
        }),
      { initialProps: { document: first } },
    );
    try {
      await waitFor(() => expect(attach).toHaveBeenCalledOnce());
      rerender({ document: edited });
      rerender({ document: second });
      await waitFor(() => expect(result.current.session?.documentId).toBe(second.id));
      await waitFor(() => expect(result.current.attached).toBe(true));
      await act(async () => {
        finish();
        await pending;
      });
      expect(capture).not.toHaveBeenCalled();
      expect(await result.current.steps()).toHaveLength(1);
    } finally {
      attach.mockRestore();
      capture.mockRestore();
    }
  });

  describe('a step the editor took locally while history was behind', () => {
    const base = createDocument('Base', true);
    const one = { ...base, name: 'One' };
    const two = { ...base, name: 'Two' };

    function stateOf(document: typeof base) {
      return {
        current: { document, dirty: false, revision: 0, sessions: [], activeId: 'tab' },
      } as unknown as NonNullable<Parameters<typeof usePersistentHistory>[0]['stateRef']>;
    }

    /** History held at attach while two edits queue up behind it. */
    function behindByTwoEdits(stateRef: ReturnType<typeof stateOf>) {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const originalAttach = EditorHistorySession.prototype.attach;
      const attach = vi
        .spyOn(EditorHistorySession.prototype, 'attach')
        .mockImplementation(async function (this: EditorHistorySession, document) {
          await pending;
          return originalAttach.call(this, document);
        });
      const patch = vi.fn();
      const historySkipRef = { current: false };
      const view = renderHook(
        ({ document }) =>
          usePersistentHistory({
            document,
            selection: [],
            patch,
            inTransactionRef: { current: false },
            historySkipRef,
            stateRef,
          }),
        { initialProps: { document: base } },
      );
      return { ...view, attach, patch, historySkipRef, finish };
    }

    it('is replayed into history behind the captures it owes, and is not recorded as an edit', async () => {
      const gated = behindByTwoEdits(stateOf(two));
      try {
        await waitFor(() => expect(gated.attach).toHaveBeenCalledOnce());
        gated.rerender({ document: one });
        gated.rerender({ document: two });

        // The editor undid its last edit from the local stack.
        act(() => gated.result.current.noteLocalNavigation('undo', one));
        expect(gated.historySkipRef.current).toBe(true);

        await act(async () => {
          gated.finish();
        });
        await waitFor(() => expect(gated.result.current.attached).toBe(true));
        const steps = await gated.result.current.steps();
        // Genesis and the first edit: the head moved back, and the second edit
        // is the redo target rather than the step before a new "undo" edit.
        expect(steps).toHaveLength(2);
        expect(gated.result.current.session?.canRedo).toBe(true);
        expect(gated.patch).not.toHaveBeenCalled();
      } finally {
        gated.attach.mockRestore();
      }
    });

    it.each([
      ['unedited since', true, 1],
      ['edited since', false, 0],
    ] as const)(
      'defers to the recorded history when they disagree and the user has %s',
      async (_label, unedited, applied) => {
        const elsewhere = { ...base, name: 'Elsewhere' };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gated = behindByTwoEdits(stateOf(unedited ? elsewhere : two));
        try {
          await waitFor(() => expect(gated.attach).toHaveBeenCalledOnce());
          gated.rerender({ document: one });
          gated.rerender({ document: two });

          // The local step landed on a document history never recorded.
          act(() => gated.result.current.noteLocalNavigation('undo', elsewhere));
          await act(async () => {
            gated.finish();
          });
          await waitFor(() => expect(gated.result.current.attached).toBe(true));
          await gated.result.current.steps();

          expect(warn).toHaveBeenCalledWith(expect.stringContaining('disagree'));
          expect(gated.patch).toHaveBeenCalledTimes(applied);
          if (applied) {
            expect(gated.patch.mock.calls[0]?.[0].document.name).toBe('One');
          }
        } finally {
          gated.attach.mockRestore();
          warn.mockRestore();
        }
      },
    );

    it('does nothing once history is current', async () => {
      const undo = vi.spyOn(EditorHistorySession.prototype, 'undo');
      const historySkipRef = { current: false };
      const { result } = renderHook(() =>
        usePersistentHistory({
          document: base,
          selection: [],
          patch: vi.fn(),
          inTransactionRef: { current: false },
          historySkipRef,
          stateRef: stateOf(two),
        }),
      );
      try {
        await waitFor(() => expect(result.current.attached).toBe(true));
        await result.current.steps();

        act(() => result.current.noteLocalNavigation('undo', one));
        await result.current.steps();

        expect(historySkipRef.current).toBe(false);
        expect(undo).not.toHaveBeenCalled();
      } finally {
        undo.mockRestore();
      }
    });
  });

  it.each(['undo', 'redo', 'checkout', 'switchBranch'] as const)(
    'does not apply %s completed after switching documents',
    async (method) => {
      const first = createDocument('First', true);
      const second = createDocument('Second', true);
      let finish!: (result: { document: typeof first; selection: string[] }) => void;
      const pending = new Promise<{ document: typeof first; selection: string[] }>((resolve) => {
        finish = resolve;
      });
      const undo = vi.spyOn(EditorHistorySession.prototype, method).mockReturnValue(pending);
      const patch = vi.fn();
      const inTransactionRef = { current: false };
      const historySkipRef = { current: false };
      const { result, rerender } = renderHook(
        ({ document }) =>
          usePersistentHistory({
            document,
            selection: [],
            patch,
            inTransactionRef,
            historySkipRef,
          }),
        { initialProps: { document: first } },
      );
      try {
        await waitFor(() => expect(result.current.attached).toBe(true));
        const navigation =
          method === 'undo' || method === 'redo'
            ? result.current[method]()
            : result.current[method]('target');
        await waitFor(() => expect(undo).toHaveBeenCalledOnce());
        rerender({ document: second });
        await waitFor(() => expect(result.current.session?.documentId).toBe(second.id));
        await act(async () => {
          finish({ document: first, selection: [] });
          await navigation;
        });
        expect(patch).not.toHaveBeenCalled();
      } finally {
        undo.mockRestore();
      }
    },
  );
});
