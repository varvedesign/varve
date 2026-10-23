import {
  createDocument,
  makeGroupNode,
  makeShapeNode,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';
import { selectMatchingEntryIds } from './layerMatchSelection';
import type { FlatEntry } from './useFlatTree';

const doc = createDocument();

function entry(node: SceneNode, depth = 0): FlatEntry {
  return { node, depth, parentId: null, childrenVisible: false };
}

const group = makeGroupNode('group' as unknown as NodeId, {
  name: 'Toolbar',
  children: [],
});
const button = makeShapeNode(
  'button' as unknown as NodeId,
  { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
  { name: 'Primary Button' },
);

describe('selectMatchingEntryIds', () => {
  it('excludes ancestors kept only for context', () => {
    const entries = [entry(group), entry(button, 1)];
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'button' };

    expect(selectMatchingEntryIds(entries, filter, doc, new Set([button.id]), new Set())).toEqual([
      button.id,
    ]);
  });

  it('applies every non-search dimension to the selected result', () => {
    const entries = [entry(group), entry(button, 1)];
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, kinds: ['shape'] };

    expect(selectMatchingEntryIds(entries, filter, doc, undefined, new Set())).toEqual([button.id]);
  });

  it('requires both the search set and the remaining dimensions', () => {
    const entries = [entry(group), entry(button, 1)];
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'button', kinds: ['group'] };

    // Search matches only the button, but the kind filter excludes it; the
    // group matches the kind but not the search. The intersection is empty.
    expect(selectMatchingEntryIds(entries, filter, doc, new Set([button.id]), new Set())).toEqual(
      [],
    );
  });

  it('treats every visible row as a result when no filter is active', () => {
    const entries = [entry(group), entry(button, 1)];
    expect(selectMatchingEntryIds(entries, DEFAULT_FILTER, doc, undefined, new Set())).toEqual([
      group.id,
      button.id,
    ]);
  });

  it('uses the animated id set for the motion preset', () => {
    const entries = [entry(group), entry(button, 1)];
    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, attributes: { animated: true } };

    expect(selectMatchingEntryIds(entries, filter, doc, undefined, new Set([button.id]))).toEqual([
      button.id,
    ]);
  });
});
