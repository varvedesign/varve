/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
/**
 * Regression coverage for a bug found during Auto Layout canvas-manipulation
 * work: the frame's own Width and Height sizing selects in the Sizing
 * subsection must update independent axes.
 */
import { createMemoryPlatform } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { LayoutSection } from './LayoutSection';

afterEach(cleanup);

beforeEach(() => {
  sessionStorage.clear();
});

function setup() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Harness() {
    ctx = useEditor();
    const id = ctx.state.selection[0];
    const frame = id ? ctx.state.document.nodes[id] : undefined;
    if (frame?.kind !== 'frame') return null;
    return <LayoutSection node={frame} />;
  }
  const platform = createMemoryPlatform();
  render(
    <EditorProvider platform={platform}>
      <Harness />
    </EditorProvider>,
  );
  if (!ctx) throw new Error('ctx not found');
  return () => ctx as NonNullable<typeof ctx>;
}

describe('LayoutSection per-node Width/Height sizing controls', () => {
  it('exposes and persists space-evenly distribution', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Layout mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Flex' }));
    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      expect(getCtx().state.document.nodes[id]?.kind).toBe('frame');
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Space evenly' }));
    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.kind === 'frame' && node.layoutStyle?.justifyContent).toBe('spaceEvenly');
    });
  });

  it('changing Width sizing sets layoutSizingWidth without touching layoutSizingHeight', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Width sizing mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Hug contents' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingWidth).toBe('hug');
      expect(node?.layoutSizingHeight).toBeUndefined();
    });
  });

  it('changing Height sizing sets layoutSizingHeight without touching layoutSizingWidth', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Height sizing mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Fill container' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingHeight).toBe('fill');
      expect(node?.layoutSizingWidth).toBeUndefined();
    });
  });

  it('does not show grid placement on an ordinary frame container', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    expect(screen.queryByText('Grid placement')).not.toBeInTheDocument();
  });

  it('explains invalid grid definitions and confirms existing positions were retained', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));
    const frameId = getCtx().state.selection[0] as string;
    getCtx().setNodeLayout(frameId, {
      mode: 'grid',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
      gridTemplateColumns: 'minmax(10px, 1fr)',
      gridTemplateRows: '1fr',
    });
    getCtx().createTextNodeAt({ x: 20, y: 30 }, { w: 80, h: 24 }, frameId, 'kept');
    getCtx().setSelection(frameId);

    expect(
      await screen.findByText(
        'Grid tracks use unsupported or invalid syntax. Existing child positions were kept.',
      ),
    ).toBeInTheDocument();
  });

  it('reports flex main-axis overflow when item shrinking is disabled', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Compact Frame', w: 120, h: 160 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));
    const frameId = getCtx().state.selection[0] as string;
    getCtx().setNodeLayout(frameId, {
      mode: 'flex',
      direction: 'row',
      gap: 10,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    });
    getCtx().createTextNodeAt({ x: 0, y: 0 }, { w: 100, h: 24 }, frameId, 'one');
    getCtx().createTextNodeAt({ x: 0, y: 0 }, { w: 100, h: 24 }, frameId, 'two');
    getCtx().setSelection(frameId);

    expect(
      await screen.findByText(
        'Flex items exceed the available main-axis space; overflow remains visible.',
      ),
    ).toHaveClass('insp-hint--warning');
  });

  it('setting both axes independently keeps them independent', async () => {
    const getCtx = setup();
    getCtx().applyFramePreset({ name: 'Test Frame', w: 400, h: 300 });
    await waitFor(() => expect(getCtx().state.selection).toHaveLength(1));

    fireEvent.click(screen.getByRole('combobox', { name: 'Width sizing mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Hug contents' }));
    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      expect(getCtx().state.document.nodes[id]?.layoutSizingWidth).toBe('hug');
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Height sizing mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Fill container' }));

    await waitFor(() => {
      const id = getCtx().state.selection[0] as string;
      const node = getCtx().state.document.nodes[id];
      expect(node?.layoutSizingWidth).toBe('hug');
      expect(node?.layoutSizingHeight).toBe('fill');
    });
  });
});
