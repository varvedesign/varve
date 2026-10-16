import { applyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeGroupNode, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import {
  MAX_OBJECT_REPEAT_INSTANCES,
  objectRepeatTransforms,
  objectRepeatWorldTransforms,
} from './objectRepeat';

describe('objectRepeatTransforms', () => {
  it('keeps the source first and lays out a bounded local grid in paint order', () => {
    const transforms = objectRepeatTransforms({
      type: 'grid',
      columns: 3,
      rows: 2,
      spacingX: 24,
      spacingY: 40,
    });

    expect(transforms).toHaveLength(6);
    expect(applyAffine(transforms[0]!, [3, 4])).toEqual([3, 4]);
    expect(applyAffine(transforms[1]!, [3, 4])).toEqual([27, 4]);
    expect(applyAffine(transforms[3]!, [3, 4])).toEqual([3, 44]);
  });

  it('places radial instances around the configured center without a full-turn seam', () => {
    const transforms = objectRepeatTransforms({
      type: 'radial',
      copies: 4,
      center: [10, 10],
      sweep: 360,
    });
    const points = transforms.map((transform) => applyAffine(transform, [20, 10]));

    expect(points[0]).toEqual([20, 10]);
    expect(points[1]![0]).toBeCloseTo(10);
    expect(points[1]![1]).toBeCloseTo(20);
    expect(points[2]![0]).toBeCloseTo(0);
    expect(points[2]![1]).toBeCloseTo(10);
    expect(points[3]![0]).toBeCloseTo(10);
    expect(points[3]![1]).toBeCloseTo(0);
    expect(points[3]).not.toEqual(points[0]);
  });

  it('emits only enabled mirror axes and reflects around the local center', () => {
    const transforms = objectRepeatTransforms({
      type: 'mirror',
      horizontal: true,
      vertical: false,
      center: [10, 5],
    });

    expect(transforms).toHaveLength(2);
    expect(applyAffine(transforms[1]!, [14, 8])).toEqual([6, 8]);
  });

  it('replaces non-finite repeat centers with a safe origin', () => {
    const transforms = objectRepeatTransforms({
      type: 'radial',
      copies: 2,
      center: [Number.NaN, Number.POSITIVE_INFINITY],
      sweep: 180,
    });

    expect(transforms).toHaveLength(2);
    expect(transforms.every((transform) => transform.every(Number.isFinite))).toBe(true);
  });

  it('clamps malformed grid dimensions and total work to the shared ceiling', () => {
    expect(
      objectRepeatTransforms({
        type: 'grid',
        columns: Number.POSITIVE_INFINITY,
        rows: Number.NaN,
        spacingX: 5,
        spacingY: 5,
      }),
    ).toHaveLength(1);
    expect(
      objectRepeatTransforms({
        type: 'grid',
        columns: 32,
        rows: 32,
        spacingX: 5,
        spacingY: 5,
      }),
    ).toHaveLength(MAX_OBJECT_REPEAT_INSTANCES);
    expect(
      objectRepeatTransforms({
        type: 'radial',
        copies: 100_000,
        center: [0, 0],
        sweep: 360,
      }),
    ).toHaveLength(MAX_OBJECT_REPEAT_INSTANCES);
  });

  it('round-trips a live repeat recipe while preserving the editable source group', () => {
    let document = createDocument('Live repeat', true);
    const source = makeShapeNode('source', { kind: 'rect', x: 10, y: 20, w: 30, h: 40 });
    const group = makeGroupNode('repeat-group', {
      children: ['source'],
      objectRepeat: { type: 'grid', columns: 3, rows: 1, spacingX: 80, spacingY: 0 },
    });
    document = addNode(addNode(document, source), group);

    const result = DocumentCodec.decode(DocumentCodec.encode(document));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nodes[group.id]).toMatchObject({
      kind: 'group',
      children: ['source'],
      objectRepeat: { type: 'grid', columns: 3, rows: 1, spacingX: 80, spacingY: 0 },
    });
    expect(result.document.nodes.source).toMatchObject({ kind: 'shape', id: 'source' });
  });

  it('lifts repeat transforms into world space around the group transform', () => {
    const groupWorld: [number, number, number, number, number, number] = [0, 1, -1, 0, 100, 50];
    const [source, copy] = objectRepeatWorldTransforms(
      { type: 'grid', columns: 2, rows: 1, spacingX: 40, spacingY: 0 },
      groupWorld,
    );

    expect(applyAffine(source!, [5, 7])).toEqual([5, 7]);
    expect(applyAffine(copy!, [5, 7])).toEqual([5, 47]);
  });
});
