import { addNode, createDocument, makeGroupNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { expandObjectRepeat, releaseObjectRepeat } from './objectRepeatExpansion';

describe('live object repeat expansion', () => {
  it('materializes independent copies in deterministic order and preserves the source', () => {
    let document = createDocument('Expand repeat', true);
    const source = makeShapeNode('source', { kind: 'rect', x: 12, y: 7, w: 20, h: 10 });
    const group = makeGroupNode('repeat-group', {
      children: [source.id],
      objectRepeat: { type: 'grid', columns: 3, rows: 1, spacingX: 40, spacingY: 0 },
    });
    document = addNode(addNode(document, source), group);
    const sourceBeforeExpansion = document.nodes[source.id];

    const expanded = expandObjectRepeat(document, group.id);
    const updatedGroup = expanded.document.nodes[group.id];

    expect(updatedGroup).toMatchObject({ kind: 'group', objectRepeat: undefined });
    if (updatedGroup?.kind !== 'group') return;
    expect(updatedGroup.children).toHaveLength(3);
    expect(updatedGroup.children[0]).toBe(source.id);
    expect(expanded.document.nodes[source.id]).toEqual(sourceBeforeExpansion);
    expect(expanded.generatedRootIds).toHaveLength(2);
    const firstCopy = expanded.document.nodes[expanded.generatedRootIds[0]!];
    const secondCopy = expanded.document.nodes[expanded.generatedRootIds[1]!];
    expect(firstCopy?.kind).toBe('shape');
    expect(secondCopy?.kind).toBe('shape');
    if (firstCopy?.kind !== 'shape' || secondCopy?.kind !== 'shape') return;
    expect(firstCopy.transform).toEqual([1, 0, 0, 1, 40, 0]);
    expect(secondCopy.transform).toEqual([1, 0, 0, 1, 80, 0]);
    expect(firstCopy.id).not.toBe(source.id);
    expect(firstCopy.shape).toEqual(source.shape);
  });

  it('refuses expansions above the node budget without mutating the input', () => {
    let document = createDocument('Bounded repeat', true);
    const sourceIds = Array.from({ length: 100 }, (_, index) => {
      const source = makeShapeNode(`source-${index}`, {
        kind: 'rect',
        x: index,
        y: 0,
        w: 1,
        h: 1,
      });
      document = addNode(document, source);
      return source.id;
    });
    const group = makeGroupNode('repeat-group', {
      children: sourceIds,
      objectRepeat: { type: 'radial', copies: 512, center: [0, 0], sweep: 180 },
    });
    document = addNode(document, group);
    const originalNodeCount = Object.keys(document.nodes).length;

    expect(() => expandObjectRepeat(document, group.id)).toThrow(/limited to 50,000/);
    expect(Object.keys(document.nodes)).toHaveLength(originalNodeCount);
    expect(document.nodes[group.id]).toMatchObject({ objectRepeat: { type: 'radial' } });
  });

  it('releases only the recipe and leaves authored children intact', () => {
    const source = makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const group = makeGroupNode('repeat-group', {
      children: [source.id],
      objectRepeat: { type: 'radial', copies: 6, center: [5, 5], sweep: 360 },
    });
    const document = addNode(addNode(createDocument('Release repeat', true), source), group);

    const released = releaseObjectRepeat(document, group.id);

    expect(released.nodes[group.id]).toMatchObject({
      kind: 'group',
      children: [source.id],
      objectRepeat: undefined,
    });
    expect(Object.keys(released.nodes)).toHaveLength(Object.keys(document.nodes).length);
  });
});
