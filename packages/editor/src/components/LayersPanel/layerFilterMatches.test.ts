import type { SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { ownFilterMatchIds, stepMatchId } from './layerFilterMatches';
import { DEFAULT_FILTER } from './layerFilterTypes';
import type { FlatEntry } from './useFlatTree';

function entry(id: string, name: string, kind: SceneNode['kind'] = 'shape'): FlatEntry {
  return { node: { id, name, kind } as SceneNode, depth: 0, parentId: null };
}

describe('ownFilterMatchIds', () => {
  const rows = [entry('card', 'Card', 'frame'), entry('btn', 'Button'), entry('label', 'Label')];

  it('leaves out ancestors shown only as context', () => {
    const search = { ...DEFAULT_FILTER, search: 'button' };
    expect(ownFilterMatchIds(rows, search, new Set(['btn']), {})).toEqual(['btn']);
  });

  it('checks non-index dimensions per node', () => {
    const frames = { ...DEFAULT_FILTER, kinds: ['frame' as const] };
    expect(ownFilterMatchIds(rows, frames, undefined, {})).toEqual(['card']);
  });

  it('is undefined when nothing is filtered', () => {
    expect(ownFilterMatchIds(rows, DEFAULT_FILTER, undefined, {})).toBeUndefined();
  });
});

describe('stepMatchId', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const matches = ['b', 'd'];

  it('wraps forward and back from a match', () => {
    expect(stepMatchId(matches, order, 'b', 1)).toBe('d');
    expect(stepMatchId(matches, order, 'd', 1)).toBe('b');
    expect(stepMatchId(matches, order, 'b', -1)).toBe('d');
  });

  it('continues from a non-matching row in either direction', () => {
    expect(stepMatchId(matches, order, 'c', 1)).toBe('d');
    expect(stepMatchId(matches, order, 'c', -1)).toBe('b');
    expect(stepMatchId(matches, order, 'e', 1)).toBe('b');
  });

  it('starts at the first or last match without a reference row', () => {
    expect(stepMatchId(matches, order, null, 1)).toBe('b');
    expect(stepMatchId(matches, order, undefined, -1)).toBe('d');
    expect(stepMatchId([], order, 'b', 1)).toBeUndefined();
  });
});
