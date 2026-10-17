import type { Document, FrameNode, LayoutStyle, SceneNode } from '@varve/scene';
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  createGridTrack,
  initializeGridTracks,
  previewRemoveGridTrack,
  reorderGridTrack,
  resizeGridTrack,
} from '../gridTrackMutations';

const style: LayoutStyle = {
  mode: 'grid',
  layoutSemanticsVersion: 2,
  direction: 'row',
  gap: 0,
  wrap: false,
  padding: [0, 0, 0, 0],
  grow: 0,
  shrink: 0,
  gridTemplateColumns: '1fr auto',
  gridTemplateRows: '1fr',
};

function makeChild(id: string, gridPlacement?: SceneNode['gridPlacement']): SceneNode {
  return {
    id,
    name: id,
    kind: 'shape',
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 1 },
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fills: [],
    strokes: [],
    effects: [],
    gridPlacement,
  } as SceneNode;
}

function makeDocument(): Document {
  const base = createDocument('grid tracks', true);
  const frame: FrameNode = {
    id: 'frame',
    name: 'Grid',
    kind: 'frame',
    transform: [1, 0, 0, 1, 0, 0],
    w: 300,
    h: 100,
    children: ['a', 'b'],
    layoutStyle: { ...style, gridTemplateColumns: '1fr 1fr 1fr' },
    fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 1 },
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    strokes: [],
    effects: [],
  };
  return {
    ...base,
    nodes: {
      ...base.nodes,
      frame,
      a: makeChild('a', { gridColumnStart: 2, gridColumnEnd: 3, gridRowStart: 1, gridRowEnd: 2 }),
      b: makeChild('b', { gridColumnStart: 3, gridColumnEnd: 4, gridRowStart: 1, gridRowEnd: 2 }),
    },
  };
}

describe('grid track mutations', () => {
  it('keeps track identities through add, resize, and reorder', () => {
    const initial = initializeGridTracks(style, 'columns', 'frame');
    expect(initial?.map(({ id, size }) => [id, size])).toEqual([
      ['grid-frame-column-1', '1fr'],
      ['grid-frame-column-2', 'auto'],
    ]);
    const resized = resizeGridTrack(style, 'columns', 'frame', initial![0]!.id, '120px');
    expect(resized?.gridColumnTracks?.[0]).toEqual({ id: initial![0]!.id, size: '120px' });
    const reordered = reorderGridTrack(resized!, 'columns', 'frame', initial![0]!.id, 1);
    expect(reordered?.gridColumnTracks?.map(({ id }) => id)).toEqual([
      initial![1]!.id,
      initial![0]!.id,
    ]);
    const added = createGridTrack(reordered!, 'columns', 'frame', '2fr', 1);
    expect(added?.gridColumnTracks?.map(({ size }) => size)).toEqual(['auto', '2fr', '120px']);
  });

  it('refuses a reorder that separates the identities covered by a span', () => {
    const threeTracks: LayoutStyle = { ...style, gridTemplateColumns: '1fr 1fr 1fr' };
    const tracks = initializeGridTracks(threeTracks, 'columns', 'frame')!;
    const span = [{ gridColumnStartTrackId: tracks[1]!.id, gridColumnSpan: 2 }];

    expect(reorderGridTrack(threeTracks, 'columns', 'frame', tracks[2]!.id, 1, span)).toBeNull();
    expect(
      reorderGridTrack(threeTracks, 'columns', 'frame', tracks[0]!.id, 2, span)?.gridColumnTracks,
    ).toEqual([tracks[1], tracks[2], tracks[0]]);
  });

  it('previews removal and rehomes anchored content without changing the source document', () => {
    const doc = makeDocument();
    const preview = previewRemoveGridTrack(doc, 'frame', 'columns', 'grid-frame-column-2');
    expect(preview?.valid).toBe(true);
    expect(preview?.rehomes.map(({ nodeId }) => nodeId).sort()).toEqual(['a', 'b']);
    expect(preview?.placements.a?.gridColumnStartTrackId).toBe('grid-frame-column-1');
    expect(preview?.placements.b?.gridColumnStartTrackId).toBe('grid-frame-column-3');
    expect(preview?.resolvedDocument.nodes.a?.transform[4]).toBe(0);
    expect(preview?.resolvedDocument.nodes.b?.transform[4]).toBe(150);
    expect(
      doc.nodes.frame?.kind === 'frame' && doc.nodes.frame.layoutStyle?.gridColumnTracks,
    ).toBeUndefined();
    expect(doc.nodes.a?.gridPlacement?.gridColumnStart).toBe(2);
  });
});
