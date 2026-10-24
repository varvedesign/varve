import { renderHook } from '@testing-library/react';
import {
  createDocument,
  DEFAULT_EMAIL_SEMANTIC,
  DEFAULT_EMAIL_SEMANTIC_MAP,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER } from './layerFilterTypes';
import { useFlatTree } from './useFlatTree';

function fixture() {
  const node = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  return { ...createDocument('filters', true), nodes: { child: node }, rootChildren: ['child'] };
}

describe('live filter invalidation', () => {
  it('updates an already-active email filter when only document metadata changes', () => {
    const doc = fixture();
    const expanded = new Set<string>();
    const filter = { ...DEFAULT_FILTER, attributes: { mobileHidden: true } };
    const { result, rerender } = renderHook(
      ({ document }) => useFlatTree(document, expanded, filter),
      {
        initialProps: { document: doc },
      },
    );
    expect(result.current).toHaveLength(0);
    rerender({
      document: {
        ...doc,
        emailSemantics: {
          ...DEFAULT_EMAIL_SEMANTIC_MAP,
          nodes: { child: { ...DEFAULT_EMAIL_SEMANTIC, hideOnMobile: true } },
        },
      } as typeof doc,
    });
    expect(result.current.map((entry) => entry.node.id)).toEqual(['child']);
    rerender({ document: doc });
    expect(result.current).toHaveLength(0);
  });

  it('updates an active export-region filter when only the frame role changes', () => {
    const frame = makeFrameNode('frame', { name: 'Artwork', w: 100, h: 100 });
    const doc = { ...createDocument('regions', true), nodes: { frame }, rootChildren: ['frame'] };
    const expanded = new Set<string>();
    const filter = { ...DEFAULT_FILTER, attributes: { exportRegion: true } };
    const { result, rerender } = renderHook(
      ({ document }) => useFlatTree(document, expanded, filter),
      {
        initialProps: { document: doc },
      },
    );
    expect(result.current).toHaveLength(0);
    rerender({ document: { ...doc, nodes: { frame: { ...frame, frameRole: 'exportRegion' } } } });
    expect(result.current.map((entry) => entry.node.id)).toEqual(['frame']);
  });

  it('keeps changed disclosure when a document metadata edit arrives in the same render', () => {
    const base = fixture();
    const frame = makeFrameNode('frame', { w: 100, h: 100, children: ['child'] });
    const doc = { ...base, nodes: { ...base.nodes, frame }, rootChildren: ['frame'] };
    const { result, rerender } = renderHook(
      ({ document, expanded }) => useFlatTree(document, expanded),
      { initialProps: { document: doc, expanded: new Set(['frame']) } },
    );
    expect(result.current).toHaveLength(2);
    rerender({ document: { ...doc, name: 'Renamed document' }, expanded: new Set() });
    expect(result.current.map((entry) => entry.node.id)).toEqual(['frame']);
  });
});
