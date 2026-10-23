/**
 * Defaults for objects drawn on the canvas.
 *
 * Shapes take a neutral grey, because the scene's teal default is the canvas
 * accent and hid selection bounds and guides on every fresh shape (F-28).
 * Text takes whatever ink the Text tool chose for its surface (F-09).
 */

import { render, waitFor } from '@testing-library/react';
import { DRAWN_SHAPE_FILL, LIGHT_TEXT_INK, type SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../context';

function mountEditor() {
  let ctx: ReturnType<typeof useEditor> | undefined;
  function Probe() {
    ctx = useEditor();
    return null;
  }
  render(
    <EditorProvider>
      <Probe />
    </EditorProvider>,
  );
  return () => {
    if (!ctx) throw new Error('editor context not mounted');
    return ctx;
  };
}

async function newNode(getCtx: ReturnType<typeof mountEditor>, create: () => void) {
  const before = new Set(Object.keys(getCtx().state.document.nodes));
  create();
  let created: SceneNode | undefined;
  await waitFor(() => {
    created = Object.values(getCtx().state.document.nodes).find(
      (n) => !before.has(n.id) && n.kind !== 'group' && n.kind !== 'frame',
    );
    expect(created).toBeDefined();
  });
  return created!;
}

describe('drawn shape fill', () => {
  it('fills a drawn rectangle with the neutral grey, not the accent', async () => {
    const getCtx = mountEditor();
    getCtx().setTool('rect');
    const rect = await newNode(getCtx, () =>
      getCtx().createShapeAt({ x: 40, y: 40 }, { w: 80, h: 60 }),
    );
    expect(rect.fill).toEqual(DRAWN_SHAPE_FILL);
  });

  it('fills a pen path with the same grey', async () => {
    const getCtx = mountEditor();
    getCtx().setTool('pen');
    const path = await newNode(getCtx, () =>
      getCtx().createShapeAt(
        { x: 0, y: 0 },
        undefined,
        null,
        [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 50, y: 0, handleIn: null, handleOut: null },
          { x: 25, y: 40, handleIn: null, handleOut: null },
        ],
        true,
      ),
    );
    expect(path.fill).toEqual(DRAWN_SHAPE_FILL);
  });
});

describe('text creation ink', () => {
  it('uses the ink the caller supplies', async () => {
    const getCtx = mountEditor();
    const text = await newNode(getCtx, () =>
      getCtx().createTextNodeAt({ x: 10, y: 10 }, undefined, null, 'Hi', LIGHT_TEXT_INK),
    );
    expect(text.fill).toEqual(LIGHT_TEXT_INK);
  });

  it('keeps the scene default when no ink is supplied', async () => {
    const getCtx = mountEditor();
    const text = await newNode(getCtx, () =>
      getCtx().createTextNodeAt({ x: 10, y: 10 }, undefined, null, 'Hi'),
    );
    expect(text.fill).toEqual({ space: 'rgb', r: 16, g: 21, b: 31, a: 255 });
  });
});
