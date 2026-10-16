import type { SmartAnimateLayerValues } from '@varve/prototype';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeSmartAnimateHotspotOverrides } from './smartAnimateBridge';

/**
 * The caller supplies a layer's **composed scene rectangle** (the presenter
 * passes `nodeWorldBounds`). It used to be handed a *local* rect that
 * `hotspotLayout` then combined with the node's own `transform[4..5]`, which
 * double-counted nesting and ignored ancestors entirely.
 */
const SCENE_BOUNDS: Record<string, { x: number; y: number; w: number; h: number }> = {
  r1: { x: 10, y: 20, w: 100, h: 50 },
  r2: { x: 110, y: 220, w: 100, h: 50 },
};
const getSceneBounds = (id: string) => SCENE_BOUNDS[id] ?? null;

describe('computeSmartAnimateHotspotOverrides', () => {
  it('interpolates matched hotspot position between screens', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Button',
          transform: [1, 0, 0, 1, 10, 20],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Button',
          transform: [1, 0, 0, 1, 110, 220],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Button' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Button: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 10, 20], to: [1, 0, 0, 1, 110, 220] },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );

    expect(mid.from.r1?.left).toBeGreaterThan(10);
    expect(mid.from.r1?.left).toBeLessThan(110);
    expect(mid.to.r2?.top).toBeGreaterThan(20);
    expect(mid.to.r2?.top).toBeLessThan(220);
  });

  it('interpolates rotation between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Card',
          rotation: 0,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Card',
          rotation: 90,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Card' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Card: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        rotation: { from: 0, to: 90 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );
    expect(mid.from.r1?.rotation).toBe(45);
    expect(mid.to.r2?.rotation).toBe(45);
  });

  it('interpolates cornerRadius between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Pill',
          cornerRadius: 4,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Pill',
          cornerRadius: 25,
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Pill' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Pill: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        cornerRadius: { from: 4, to: 25 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );
    expect(mid.from.r1?.cornerRadius).toBe(14.5);
    expect(mid.to.r2?.cornerRadius).toBe(14.5);
  });

  it('interpolates fill colour between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Dot',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Dot',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Dot' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Dot: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        fill: { from: [255, 0, 0, 255], to: [0, 0, 255, 255] },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );
    // Midpoint of red→blue: expect ~128 for each channel.
    expect(mid.from.r1?.fill).toContain('rgba(');
    expect(mid.from.r1?.fill).toContain('128');
    expect(mid.to.r2?.fill).toContain('rgba(');
    expect(mid.to.r2?.fill).toContain('128');
  });

  it('interpolates strokeWidth between matched layers', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Ring',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Ring',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Ring' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Ring: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        strokeWidth: { from: 1, to: 6 },
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );
    expect(mid.from.r1?.strokeWidth).toBe(3.5);
    expect(mid.to.r2?.strokeWidth).toBe(3.5);
  });

  it('omits fill/rotation/cornerRadius/strokeWidth when not in values', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['r1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['r2'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Plain',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        {
          name: 'Plain',
          transform: [1, 0, 0, 1, 0, 0],
        },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    const matches = [{ fromId: 'r1', toId: 'r2', name: 'Plain' }];
    const values: Record<string, SmartAnimateLayerValues> = {
      Plain: {
        opacity: { from: 1, to: 1 },
        transform: { from: [1, 0, 0, 1, 0, 0], to: [1, 0, 0, 1, 0, 0] },
        // No rotation, cornerRadius, fill, or strokeWidth
      },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      matches,
      values,
      0.5,
      { kind: 'linear' },
      getSceneBounds,
    );
    // New properties default to 0/empty when absent.
    expect(mid.from.r1?.rotation).toBe(0);
    expect(mid.from.r1?.cornerRadius).toBe(0);
    expect(mid.from.r1?.fill).toBe('');
    expect(mid.from.r1?.strokeWidth).toBe(0);
  });

  /**
   * Regression for the placement defect: a nested layer's hotspot rect must
   * come from its composed scene rectangle. The old code added the node's own
   * `transform[4..5]` to whatever rect it was handed, so a nested layer's
   * interpolated position was wrong by every ancestor offset.
   */
  it('takes a nested layer position from composed scene bounds', () => {
    let doc = createDocument('SA');
    doc = addNode(doc, makeFrameNode('f1', { name: 'f1', order: 'a0', children: ['g1'] }));
    doc = addNode(doc, makeFrameNode('f2', { name: 'f2', order: 'a1', children: ['g2'] }));
    // The groups sit far from the origin; the shapes inside them are children.
    doc = addNode(doc, {
      kind: 'group',
      id: 'g1',
      name: 'g1',
      transform: [1, 0, 0, 1, 400, 500],
      children: ['r1'],
    } as unknown as import('@varve/scene').SceneNode);
    doc = addNode(doc, {
      kind: 'group',
      id: 'g2',
      name: 'g2',
      transform: [1, 0, 0, 1, 900, 1200],
      children: ['r2'],
    } as unknown as import('@varve/scene').SceneNode);
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        { name: 'Nested', transform: [1, 0, 0, 1, 30, 40] },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'r2',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
        { name: 'Nested', transform: [1, 0, 0, 1, 30, 40] },
      ),
    );
    doc = { ...doc, rootChildren: ['f1', 'f2'] };

    // Composed scene rectangles: group offset + local offset.
    const composed: Record<string, { x: number; y: number; w: number; h: number }> = {
      r1: { x: 430, y: 540, w: 100, h: 50 },
      r2: { x: 930, y: 1240, w: 100, h: 50 },
    };

    const mid = computeSmartAnimateHotspotOverrides(
      doc,
      [{ fromId: 'r1', toId: 'r2', name: 'Nested' }],
      {
        Nested: {
          opacity: { from: 1, to: 1 },
          transform: { from: [1, 0, 0, 1, 30, 40], to: [1, 0, 0, 1, 30, 40] },
        },
      },
      0.5,
      { kind: 'linear' },
      (id: string) => composed[id] ?? null,
    );

    // Halfway between 430 and 930, and between 540 and 1240.
    expect(mid.from.r1?.left).toBeCloseTo(680);
    expect(mid.from.r1?.top).toBeCloseTo(890);
  });
});
