/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { GridTrackEditor } from './GridTrackEditor';

afterEach(cleanup);

function renderTrackEditor(columns: string, withSpan = false) {
  let document = createDocument('Track feedback');
  const frame = makeFrameNode('grid-frame', {
    name: 'Grid frame',
    w: 300,
    h: 100,
    layoutStyle: {
      mode: 'grid',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
      gridTemplateColumns: columns,
    },
  });
  document = addNode(document, frame);
  if (withSpan) {
    const child = {
      ...makeShapeNode('span-child', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      gridPlacement: { gridColumnStart: 1, gridColumnSpan: 2 },
    };
    document = addChild(document, frame.id, child);
  }

  function Harness() {
    const { state } = useEditor();
    const current = state.document.nodes[frame.id];
    if (current?.kind !== 'frame' || !current.layoutStyle) return null;
    return (
      <GridTrackEditor
        frameId={frame.id}
        layoutStyle={current.layoutStyle}
        document={state.document}
      />
    );
  }

  render(
    <EditorProvider initialDocumentJson={JSON.stringify(document)}>
      <Harness />
    </EditorProvider>,
  );
}

describe('GridTrackEditor blocked operations', () => {
  it('explains when moving a track would change a placed span', () => {
    renderTrackEditor('1fr 2fr 3fr', true);
    fireEvent.click(screen.getByRole('button', { name: 'Move column 1 later' }));
    expect(screen.getByText(/Cannot move this track/)).toHaveTextContent('spans the tracks');
    expect(screen.getByRole('textbox', { name: 'column 1 size' })).toHaveValue('1fr');
    expect(screen.getByRole('textbox', { name: 'column 2 size' })).toHaveValue('2fr');
    expect(screen.getByRole('textbox', { name: 'column 3 size' })).toHaveValue('3fr');
  });

  it('explains why an invalid template cannot accept another track', () => {
    renderTrackEditor('minmax(10px, 1fr)');
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(screen.getByText(/Cannot add a track/)).toHaveTextContent('repair the template');
  });
});
