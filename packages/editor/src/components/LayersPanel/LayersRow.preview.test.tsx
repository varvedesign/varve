import { fireEvent, render } from '@testing-library/react';
import type { SceneNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';

// A row only shows its preview chip for an image layer with a rendered
// thumbnail. Both are stubbed here so the test exercises the row's own wiring;
// they live in this file so the stubs do not leak into LayersRow.test.tsx.
vi.mock('./useThumbnail', () => ({
  useThumbnail: () => 'data:image/png;base64,AAAA',
}));
vi.mock('@varve/scene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@varve/scene')>()),
  isImageShape: () => true,
}));

import { LayersRow } from './LayersRow';

const node = {
  id: 'img1',
  name: 'clipboard.png',
  kind: 'shape',
  visible: true,
  locked: false,
  blendMode: 'normal',
  opacity: 1,
  bindings: {},
  fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
  shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  index: 0,
  order: 'a0',
  rotation: 0,
} as unknown as SceneNode;

function renderRow() {
  const onDoubleClickIcon = vi.fn();
  const onRenameStart = vi.fn();
  const utils = render(
    <LayersRow
      node={node}
      depth={0}
      selected={false}
      focused={false}
      expanded={false}
      editing={false}
      totalRows={1}
      idx={0}
      onToggleExpand={vi.fn()}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onRenameStart={onRenameStart}
      onRenameCommit={vi.fn()}
      onRenameCancel={vi.fn()}
      onToggleVisibility={vi.fn()}
      onToggleLock={vi.fn()}
      onFocus={vi.fn()}
      onDoubleClickIcon={onDoubleClickIcon}
    />,
  );
  return { ...utils, onDoubleClickIcon, onRenameStart };
}

describe('LayersRow preview', () => {
  it('double-clicking the preview zooms to the layer instead of starting a rename', () => {
    const { container, onDoubleClickIcon, onRenameStart } = renderRow();
    const preview = container.querySelector('.layers-row__thumbnail');
    expect(preview).not.toBeNull();

    fireEvent.doubleClick(preview as Element);

    expect(onDoubleClickIcon).toHaveBeenCalledWith('img1');
    expect(onRenameStart).not.toHaveBeenCalled();
  });

  it('double-clicking the name still starts a rename', () => {
    const { container, onDoubleClickIcon, onRenameStart } = renderRow();
    fireEvent.doubleClick(container.querySelector('.layers-row__name') as Element);

    expect(onRenameStart).toHaveBeenCalledWith('img1');
    expect(onDoubleClickIcon).not.toHaveBeenCalled();
  });
});
