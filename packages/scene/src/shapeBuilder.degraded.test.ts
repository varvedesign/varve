import { describe, expect, it, vi } from 'vitest';
import { addNode, createDocument, makeShapeNode } from './document';
import {
  applyShapeBuilderAction,
  buildShapeBuilderModel,
  previewShapeBuilderSelection,
} from './shapeBuilder';

const clipperHarness = vi.hoisted(() => ({
  failDifference: false,
  failUnion: false,
  failUnionRemaining: 0,
  unionCalls: 0,
}));

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
      'Unable to complete output ring starting at [0, 0]. Last matching segment ends at [1, 1].',
    );
  };
  const difference = (...args: never[]) => {
    if (clipperHarness.failDifference) return fail();
    return kernel.difference(...args);
  };
  const union = (...args: never[]) => {
    clipperHarness.unionCalls += 1;
    if (clipperHarness.failUnion || clipperHarness.failUnionRemaining > 0) {
      if (clipperHarness.failUnionRemaining > 0) clipperHarness.failUnionRemaining -= 1;
      return fail();
    }
    return kernel.union(...args);
  };
  const wrapped = {
    union,
    intersection: kernel.intersection,
    xor: kernel.xor,
    difference,
  };
  return { ...actual, ...wrapped, default: wrapped };
});

const identity = [1, 0, 0, 1, 0, 0] as const;

function rectangles() {
  let doc = createDocument('shape-builder-degraded', true);
  doc = addNode(
    doc,
    makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  doc = addNode(
    doc,
    makeShapeNode('b', { kind: 'rect', x: 50, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  return doc;
}

describe('Shape Builder degraded clipper results', () => {
  it('does not retry a failed union while previewing a selection', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    clipperHarness.unionCalls = 0;
    clipperHarness.failUnionRemaining = 1;
    try {
      const preview = previewShapeBuilderSelection(
        model,
        model.faces.map((face) => face.id),
      );
      expect(preview.degraded).toBe(true);
      expect(clipperHarness.unionCalls).toBe(1);
    } finally {
      clipperHarness.failUnionRemaining = 0;
    }
  });

  it('refuses to commit a degraded union', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    clipperHarness.failUnion = true;
    try {
      const applied = applyShapeBuilderAction(
        doc,
        ['a', 'b'],
        model.faces.map((face) => face.id),
        'merge',
      );
      expect(applied).toMatchObject({ ok: false });
      if (applied.ok) return;
      expect(applied.reason).toMatch(/could not complete the geometry/i);
      expect(doc.nodes.a?.kind).toBe('shape');
      expect(doc.nodes.b?.kind).toBe('shape');
    } finally {
      clipperHarness.failUnion = false;
    }
  });

  it('refuses to commit a degraded subtract', () => {
    const doc = rectangles();
    const model = buildShapeBuilderModel(doc, ['a', 'b']);
    expect(model.status).toBe('ready');
    const overlap = model.faces.filter((face) => face.filledBy.length === 2).map((face) => face.id);
    expect(overlap.length).toBeGreaterThan(0);
    clipperHarness.failDifference = true;
    try {
      const applied = applyShapeBuilderAction(doc, ['a', 'b'], overlap, 'erase');
      expect(applied).toMatchObject({ ok: false });
      if (applied.ok) return;
      expect(applied.reason).toMatch(/could not complete the geometry/i);
      expect(doc.nodes.a?.kind).toBe('shape');
      expect(doc.nodes.b?.kind).toBe('shape');
    } finally {
      clipperHarness.failDifference = false;
    }
  });
});
