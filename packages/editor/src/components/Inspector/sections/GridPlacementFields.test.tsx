/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { GridPlacementFields } from './GridPlacementFields';

afterEach(cleanup);

const GRID_STYLE = {
  mode: 'grid' as const,
  direction: 'row' as const,
  gap: 8,
  wrap: false,
  padding: [0, 0, 0, 0] as [number, number, number, number],
  grow: 0,
  shrink: 1,
  gridTemplateColumns: '1fr 1fr',
};

function documentWithNodes(
  parentOverrides: Partial<ReturnType<typeof makeFrameNode>> = {},
  childOverrides: Partial<ReturnType<typeof makeShapeNode>> = {},
) {
  let document = createDocument('grid-placement-fields');
  const parent = makeFrameNode('parent', {
    name: 'Grid parent',
    ...parentOverrides,
  });
  // `makeShapeNode` intentionally exposes only the creation-time shape opts;
  // placement is a node-level field, so spread it after construction to model
  // an authored document faithfully.
  const child = {
    ...makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }, childOverrides),
    ...childOverrides,
  };
  // Keep the fixture's root simple. `addChild` owns the parent-child list and
  // should not have to reconcile a hand-authored child id before the child is
  // in the document map.
  document = addNode(document, parent);
  document = addChild(document, parent.id, child);
  return { document, parent, child };
}

describe('GridPlacementFields', () => {
  it('shows readable two-up fields for a real grid child', () => {
    const { document: sceneDocument, child } = documentWithNodes({ layoutStyle: GRID_STYLE });

    const { container } = render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[child]} />
      </EditorProvider>,
    );

    expect(screen.getByText('Grid placement')).toBeInTheDocument();
    for (const label of ['Column start', 'Column end', 'Row start', 'Row end']) {
      expect(screen.getByRole('spinbutton', { name: label })).toBeInTheDocument();
    }
    expect(container.querySelector('.insp-grid-placement__fields')).toHaveClass(
      'insp-field-group--columns-2',
    );
  });

  it('does not mount placement controls for an ordinary frame', () => {
    const { document: sceneDocument, parent } = documentWithNodes();

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[parent]} />
      </EditorProvider>,
    );

    expect(screen.queryByText('Grid placement')).not.toBeInTheDocument();
  });

  it('keeps authored placement discoverable after the layer leaves a grid', () => {
    const { document: sceneDocument, child } = documentWithNodes(
      {},
      { gridPlacement: { gridColumnStart: 2 } },
    );

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <GridPlacementFields nodes={[child]} />
      </EditorProvider>,
    );

    expect(screen.getByText(/stored on the layer/i)).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Column start' })).toHaveValue('2');
  });

  it('shows identity anchors as indices and preserves the other axis when one axis changes', async () => {
    const { document: sceneDocument, child } = documentWithNodes(
      {
        layoutStyle: {
          ...GRID_STYLE,
          gridColumnTracks: [
            { id: 'column-a', size: '1fr' },
            { id: 'column-b', size: '1fr' },
            { id: 'column-c', size: '1fr' },
          ],
          gridRowTracks: [{ id: 'row-a', size: 'auto' }],
        },
      },
      {
        gridPlacement: {
          gridColumnStartTrackId: 'column-a',
          gridColumnSpan: 2,
          gridRowStartTrackId: 'row-a',
          gridRowSpan: 1,
        },
      },
    );

    function SelectChild() {
      const { state, setSelection } = useEditor();
      useEffect(() => {
        if (!state.selection.includes(child.id)) setSelection(child.id);
      }, [state.selection, setSelection]);
      return null;
    }

    function PlacementProbe() {
      const { state } = useEditor();
      return (
        <output data-testid="placement">
          {JSON.stringify(state.document.nodes[child.id]?.gridPlacement)}
        </output>
      );
    }

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(sceneDocument)}>
        <SelectChild />
        <GridPlacementFields nodes={[child]} />
        <PlacementProbe />
      </EditorProvider>,
    );

    expect(screen.getByRole('spinbutton', { name: 'Column start' })).toHaveValue('1');
    expect(screen.getByRole('spinbutton', { name: 'Column end' })).toHaveValue('3');
    expect(screen.getByRole('spinbutton', { name: 'Row start' })).toHaveValue('1');

    const columnStart = screen.getByRole('spinbutton', { name: 'Column start' });
    fireEvent.change(columnStart, { target: { value: '2' } });
    fireEvent.blur(columnStart);

    await waitFor(() => {
      const placement = JSON.parse(screen.getByTestId('placement').textContent ?? '{}');
      expect(placement.gridColumnStartTrackId).toBe('column-b');
      expect(placement.gridColumnSpan).toBe(2);
      expect(placement.gridRowStartTrackId).toBe('row-a');
      expect(placement.gridRowSpan).toBe(1);
    });
  });
});
