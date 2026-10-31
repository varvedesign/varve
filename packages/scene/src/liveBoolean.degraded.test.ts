import { describe, expect, it, vi } from 'vitest';
import { booleanAnchorForNode } from './boolean/integration';
import { addNode, createDocument, makeShapeNode } from './document';
import {
  applyBooleanOpDoc,
  createLiveBooleanDoc,
  expandLiveBooleanDoc,
  resolveLiveBooleanShape,
} from './liveBoolean';
import type { ShapeNode } from './types';

const clipperHarness = vi.hoisted(() => ({ failUnion: false }));

vi.mock('polygon-clipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('polygon-clipping')>();
  const kernel = ((actual as { default?: typeof actual }).default ?? actual) as {
    union: (...args: never[]) => unknown;
    intersection: (...args: never[]) => unknown;
    xor: (...args: never[]) => unknown;
    difference: (...args: never[]) => unknown;
  };
  const fail = () => {
    throw new Error(
      'Unable to complete output ring starting at [0, 0]. Last matching segment found ends at [1, 1].',
    );
  };
  const union = (...args: never[]) => {
    if (clipperHarness.failUnion) return fail();
    return kernel.union(...args);
  };
  const wrapped = {
    union,
    intersection: kernel.intersection,
    xor: kernel.xor,
    difference: kernel.difference,
  };
  return { ...actual, ...wrapped, default: wrapped };
});

describe('degraded live Boolean expand', () => {
  it('keeps operands when expand would bake a clipper fallback', () => {
    clipperHarness.failUnion = true;
    try {
      let doc = createDocument();
      doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }));
      doc = addNode(doc, makeShapeNode('b', { kind: 'rect', x: 20, y: 0, w: 40, h: 40 }));
      const created = createLiveBooleanDoc(doc, ['a', 'b'], 'union');
      expect(created).not.toBeNull();
      if (!created) return;
      expect(resolveLiveBooleanShape(created.doc, created.nodeId)).not.toBeNull();
      const expanded = expandLiveBooleanDoc(created.doc, created.nodeId);
      expect(expanded).toMatchObject({ ok: false });
      expect(created.doc.nodes.a).toBeDefined();
      expect(created.doc.nodes.b).toBeDefined();
      expect(created.doc.nodes[created.nodeId]?.kind).toBe('group');
    } finally {
      clipperHarness.failUnion = false;
    }
  });

  it('keeps operands when a destructive apply would bake a clipper fallback', () => {
    clipperHarness.failUnion = true;
    try {
      let doc = createDocument();
      doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }));
      doc = addNode(doc, makeShapeNode('b', { kind: 'rect', x: 20, y: 0, w: 40, h: 40 }));
      const applied = applyBooleanOpDoc(
        doc,
        'union',
        [doc.nodes.a as ShapeNode, doc.nodes.b as ShapeNode],
        ['a', 'b'],
        booleanAnchorForNode(doc, 'a'),
      );
      expect(applied).toMatchObject({ ok: false });
      expect(doc.nodes.a).toBeDefined();
      expect(doc.nodes.b).toBeDefined();
    } finally {
      clipperHarness.failUnion = false;
    }
  });
});
