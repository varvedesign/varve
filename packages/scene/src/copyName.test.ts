import { describe, expect, it } from 'vitest';
import { copyName, deepCloneSubtree } from './clone';
import { makeShapeNode } from './document';
import type { SceneNode } from './types';

// F-10 (shell audit 2026-10-21): repeated Ctrl+D appended " copy" every time,
// so a run of duplicates produced "Rectangle 1 copy copy copy copy …" and the
// Layers panel truncated thirteen rows to the same visible prefix.
describe('copyName', () => {
  it('appends the suffix to an original name', () => {
    expect(copyName('Rectangle 1', ' copy')).toBe('Rectangle 1 copy');
  });

  it('numbers further copies instead of repeating the suffix', () => {
    expect(copyName('Rectangle 1 copy', ' copy')).toBe('Rectangle 1 copy 2');
    expect(copyName('Rectangle 1 copy 2', ' copy')).toBe('Rectangle 1 copy 3');
    expect(copyName('Rectangle 1 copy 9', ' copy')).toBe('Rectangle 1 copy 10');
  });

  it('leaves names that only contain the word alone', () => {
    expect(copyName('Hero copy text', ' copy')).toBe('Hero copy text copy');
    expect(copyName('copy', ' copy')).toBe('copy copy');
  });
});

describe('duplicate chains', () => {
  it('never grows a run of suffixes when a duplicate is duplicated', () => {
    let nodes: Record<string, SceneNode> = {
      a: makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Rectangle 1' }),
    };
    let current = 'a';
    let next = 1;
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = deepCloneSubtree(nodes, next, current, { nameSuffix: ' copy' });
      nodes = { ...nodes, ...result.nodes };
      current = result.rootId;
      next = result.nextId;
      names.push(nodes[current]!.name);
    }
    expect(names[0]).toBe('Rectangle 1 copy');
    expect(names[1]).toBe('Rectangle 1 copy 2');
    expect(names[19]).toBe('Rectangle 1 copy 20');
    expect(names.every((name) => !name.includes('copy copy'))).toBe(true);
  });
});
