/**
 * Edits and Undo made before persistent history has caught up (ADR-0241 open
 * item). History attaches asynchronously after a document opens (IndexedDB
 * open, genesis write) and records each commit asynchronously after that. A
 * cold start keeps both pending for long enough to paint and press Ctrl+Z inside
 * the window; nothing the user does there may be lost from, or mis-recorded in,
 * the history that follows.
 *
 * Each window is held open deterministically by gating one store call:
 * `listBranches` keeps attach pending, `commitRevision` keeps captures pending.
 */
import { act, render, waitFor } from '@testing-library/react';
import { type HistoryStore, validateHistory } from '@varve/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

function makeGate(): Gate {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Shared with the mock factory, which is hoisted above every import. */
const harness = vi.hoisted(() => ({
  attach: null as Gate | null,
  commit: null as Gate | null,
  stores: [] as unknown[],
}));

vi.mock('@varve/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/history')>();
  const gated = (): HistoryStore => {
    const store = actual.createMemoryHistoryStore();
    harness.stores.push(store);
    return new Proxy(store, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const gate =
          property === 'listBranches'
            ? () => harness.attach
            : property === 'commitRevision'
              ? () => harness.commit
              : null;
        if (!gate) return value.bind(target);
        return async (...args: unknown[]) => {
          await gate()?.promise;
          return value.apply(target, args);
        };
      },
    });
  };
  return { ...actual, createIndexedDbHistoryStore: gated, createMemoryHistoryStore: gated };
});

type Editor = ReturnType<typeof useEditor>;

function mount(): () => Editor {
  const ref: { editor: Editor | undefined } = { editor: undefined };
  function Consumer() {
    ref.editor = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <Consumer />
    </EditorProvider>,
  );
  return () => ref.editor!;
}

const x = (editor: Editor, id: string) => editor.state.document.nodes[id]?.transform[4];

/** Create a rect, then return a function that moves it in one transaction. */
async function seedRect(current: () => Editor) {
  await waitFor(() => expect(current()).toBeDefined());
  act(() => {
    current().setTool('rect');
    current().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
  });
  await waitFor(() => expect(current().state.selection).toHaveLength(1));
  const id = current().state.selection[0]!;
  return {
    id,
    startX: x(current(), id),
    /** One committed gesture whose updates arrive over several renders, as pointer moves do. */
    drag: async (...stops: number[]) => {
      act(() => current().beginTransaction());
      for (const stop of stops) {
        act(() => {
          current().updateNode(id, (node) => ({ ...node, transform: [1, 0, 0, 1, stop, 0] }));
        });
      }
      act(() => current().commitTransaction());
      await waitFor(() => expect(x(current(), id)).toBe(stops.at(-1)));
    },
  };
}

/** Wait until attach has finished and every queued capture and navigation has run. */
async function settle(current: () => Editor) {
  await waitFor(() => expect(current().persistentHistory.attached).toBe(true));
  await act(async () => {
    await current().persistentHistory.steps();
  });
}

async function labels(current: () => Editor): Promise<string[]> {
  return (await current().persistentHistory.steps()).map((step) => step.label);
}

/** The replayed step must have landed where the editor already was. */
function expectNoHistoryDisagreement(warn: { mock: { calls: unknown[][] } }) {
  const messages = warn.mock.calls.map((call) => String(call[0]));
  expect(messages.filter((message) => /\[history\] a local/.test(message))).toEqual([]);
}

async function integrityIssues(current: () => Editor) {
  const store = harness.stores.at(-1) as HistoryStore;
  return validateHistory(store, current().state.document.id);
}

describe('history that has not caught up yet', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn');
    harness.attach = null;
    harness.commit = null;
    harness.stores.length = 0;
  });
  afterEach(() => {
    warn.mockRestore();
    harness.attach?.release();
    harness.commit?.release();
  });

  it('keeps Undo, Redo and the recorded lineage coherent when pressed before attach', async () => {
    harness.attach = makeGate();
    const current = mount();
    const rect = await seedRect(current);
    await rect.drag(50);
    await rect.drag(100);
    expect(current().persistentHistory.attached).toBe(false);

    // The step shows at once; it does not wait for history to attach.
    act(() => current().undo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(50));
    expect(current().persistentHistory.attached).toBe(false);

    harness.attach.release();
    await settle(current);

    // Lineage up to the head: genesis, the creation, the first move. The undone
    // move is the redo target, and the undo itself is not a step.
    expect(await labels(current)).toHaveLength(3);
    expect(current().persistentHistory.session?.canRedo).toBe(true);
    expect(current().state.canRedo).toBe(true);
    expect(await integrityIssues(current)).toEqual([]);
    expectNoHistoryDisagreement(warn);

    act(() => current().redo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(100));
    act(() => current().undo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(50));
    act(() => current().undo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(rect.startX));
  });

  it('records a gesture committed before attach as the whole gesture', async () => {
    harness.attach = makeGate();
    const current = mount();
    const rect = await seedRect(current);
    await rect.drag(20, 35, 50, 80);
    expect(current().persistentHistory.attached).toBe(false);

    harness.attach.release();
    await settle(current);

    // Genesis, the creation, and exactly one step for the drag.
    expect(await labels(current)).toHaveLength(3);
    // Every revision must replay to its recorded hash: a capture whose base was
    // the previous render rather than the start of the gesture does not.
    expect(await integrityIssues(current)).toEqual([]);
    const head = current().persistentHistory.session!.headRevisionId!;
    const recorded = await current().persistentHistory.previewRevision(head);
    expect(recorded?.nodes[rect.id]?.transform[4]).toBe(80);
  });

  it('keeps the lineage coherent when Undo is pressed while the first capture is still being written', async () => {
    const current = mount();
    await waitFor(() => expect(current().persistentHistory.attached).toBe(true));

    harness.commit = makeGate();
    const rect = await seedRect(current);
    await rect.drag(50);
    // Attached, but nothing is committed yet: the session still sits at genesis,
    // which reports there is nothing to undo.
    expect(current().persistentHistory.session?.canUndo).toBe(false);

    act(() => current().undo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(rect.startX));

    harness.commit.release();
    await settle(current);

    // Genesis and the creation; the undone drag is the redo target.
    expect(await labels(current)).toHaveLength(2);
    expect(current().persistentHistory.session?.canRedo).toBe(true);
    expect(await integrityIssues(current)).toEqual([]);
    expectNoHistoryDisagreement(warn);

    act(() => current().redo());
    await waitFor(() => expect(x(current(), rect.id)).toBe(50));
  });
});
