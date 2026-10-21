import { act, render, waitFor } from '@testing-library/react';
import {
  colorConfigWithDefaults,
  createDocument,
  DocumentCodec,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';

function mount(initialDocumentJson?: string) {
  let editor: ReturnType<typeof useEditor> | undefined;
  function Consumer() {
    editor = useEditor();
    return null;
  }
  render(
    <EditorProvider initialDocumentJson={initialDocumentJson}>
      <Consumer />
    </EditorProvider>,
  );
  return () => {
    if (!editor) throw new Error('editor not ready');
    return editor;
  };
}

describe('EditorProvider owned-transaction history', () => {
  it('undo restores the document after addMaskToSelected', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    act(() => {
      get().setTool('rect');
      get().createShapeAt({ x: 10, y: 10 }, { w: 100, h: 60 });
    });
    await waitFor(() => expect(get().state.selection).toHaveLength(1));
    const id = get().state.selection[0]!;
    expect(get().state.document.nodes[id]?.mask).toBeUndefined();
    const before = get().state.document;

    act(() => get().addMaskToSelected('alpha'));
    await waitFor(() => expect(get().state.document.nodes[id]?.mask).toBeDefined());
    expect(get().state.document).not.toBe(before);

    act(() => get().undo());
    await waitFor(() => expect(get().state.document.nodes[id]?.mask).toBeUndefined());
  });

  it('undo restores the document after applyPanelLayout', async () => {
    const source = createDocument('Panel history', true);
    const frame = makeFrameNode('layout-frame', { w: 400, h: 600, children: [] });
    const initial = {
      ...source,
      nodes: { ...source.nodes, [frame.id]: frame },
      rootChildren: [...source.rootChildren, frame.id],
    };
    const get = mount(DocumentCodec.encode(initial));
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(frame.id));
    await waitFor(() => expect(get().state.selection).toEqual([frame.id]));

    const childrenBefore = [
      ...((get().state.document.nodes[frame.id] as { children?: string[] })?.children ?? []),
    ];

    act(() => get().applyPanelLayout('two-up'));
    await waitFor(() => {
      const children = (get().state.document.nodes[frame.id] as { children?: string[] })?.children;
      expect(children?.length).toBeGreaterThan(childrenBefore.length);
    });

    act(() => get().undo());
    await waitFor(() => {
      const children = (get().state.document.nodes[frame.id] as { children?: string[] })?.children;
      expect(children ?? []).toEqual(childrenBefore);
    });
  });

  it('records a frame layout change as one undoable document transaction', async () => {
    const source = createDocument('Frame layout history', true);
    const frame = makeFrameNode('frame-layout-history', { w: 400, h: 300, children: [] });
    const initial = {
      ...source,
      nodes: { ...source.nodes, [frame.id]: frame },
      rootChildren: [...source.rootChildren, frame.id],
    };
    const get = mount(DocumentCodec.encode(initial));
    await waitFor(() => expect(get()).toBeDefined());

    const layout = {
      mode: 'flex' as const,
      direction: 'row' as const,
      gap: 8,
      wrap: false,
      padding: [0, 0, 0, 0] as [number, number, number, number],
      grow: 0,
      shrink: 1,
    };
    act(() => get().setNodeLayout(frame.id, layout));
    await waitFor(() => {
      const node = get().state.document.nodes[frame.id];
      expect(node?.kind === 'frame' ? node.layoutStyle?.mode : undefined).toBe('flex');
    });

    act(() => get().undo());
    await waitFor(() => {
      const node = get().state.document.nodes[frame.id];
      expect(node?.kind === 'frame' ? node.layoutStyle : undefined).toBeUndefined();
    });
  });

  it('records a grid track layout edit as one undoable document transaction', async () => {
    const source = createDocument('Grid track history', true);
    const frame = makeFrameNode('grid-history-frame', {
      w: 400,
      h: 300,
      children: [],
      layoutStyle: {
        mode: 'grid',
        direction: 'row',
        gap: 0,
        wrap: false,
        padding: [0, 0, 0, 0],
        grow: 0,
        shrink: 1,
        gridTemplateColumns: '1fr 1fr',
      },
    });
    const initial = {
      ...source,
      nodes: { ...source.nodes, [frame.id]: frame },
      rootChildren: [...source.rootChildren, frame.id],
    };
    const get = mount(DocumentCodec.encode(initial));
    await waitFor(() => expect(get()).toBeDefined());

    const editedStyle = { ...frame.layoutStyle!, gridTemplateColumns: '1fr 1fr 1fr' };
    act(() => get().setGridTrackLayout(frame.id, editedStyle, {}));
    await waitFor(() => {
      const node = get().state.document.nodes[frame.id];
      expect(node?.kind === 'frame' ? node.layoutStyle?.gridTemplateColumns : undefined).toBe(
        '1fr 1fr 1fr',
      );
    });

    act(() => get().undo());
    await waitFor(() => {
      const node = get().state.document.nodes[frame.id];
      expect(node?.kind === 'frame' ? node.layoutStyle?.gridTemplateColumns : undefined).toBe(
        '1fr 1fr',
      );
    });
  });

  it('records a constraint edit as one undoable document transaction', async () => {
    const source = createDocument('Constraint history', true);
    const frame = makeFrameNode('constraint-history-frame', {
      w: 400,
      h: 300,
      children: ['constraint-history-child'],
    });
    const child = {
      ...makeShapeNode('constraint-history-child', {
        kind: 'rect',
        x: 24,
        y: 32,
        w: 80,
        h: 60,
      }),
      constraints: { horizontal: 'min' as const, vertical: 'min' as const },
    };
    const initial = {
      ...source,
      nodes: { ...source.nodes, [frame.id]: frame, [child.id]: child },
      rootChildren: [...source.rootChildren, frame.id],
    };
    const get = mount(DocumentCodec.encode(initial));
    await waitFor(() => expect(get()).toBeDefined());
    act(() => get().setSelection(child.id));
    await waitFor(() => expect(get().state.selection).toEqual([child.id]));

    const historyWarning = vi.spyOn(console, 'warn');
    act(() => get().setSelectedConstraint({ horizontal: 'max', vertical: 'min' }));
    await waitFor(() => {
      const node = get().state.document.nodes[child.id];
      expect(node?.constraints?.horizontal).toBe('max');
    });
    expect(historyWarning).not.toHaveBeenCalledWith(
      '[history] updateDoc called outside transaction — this mutation bypasses persistent history capture',
    );
    historyWarning.mockRestore();

    act(() => get().undo());
    await waitFor(() => {
      const node = get().state.document.nodes[child.id];
      expect(node?.constraints).toEqual({ horizontal: 'min', vertical: 'min' });
    });
  });

  it('undo restores the document after a blend evaluation change', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeDefined());

    const before = colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace;
    expect(before).not.toBe('linear-srgb');

    act(() => get().setDocumentBlendEvaluationSpace('linear-srgb'));
    await waitFor(() =>
      expect(colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace).toBe(
        'linear-srgb',
      ),
    );

    act(() => get().undo());
    await waitFor(() =>
      expect(colorConfigWithDefaults(get().state.document.colorConfig).blendEvaluationSpace).toBe(
        before,
      ),
    );
  });
});
