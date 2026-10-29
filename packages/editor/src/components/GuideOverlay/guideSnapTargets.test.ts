import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  setSnapExcluded,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { type GuideSnapTarget, getGuideSnapTargets, snapGuidePosition } from './guideSnapTargets';

function withRect(doc: Document, id: string, rect: { x: number; y: number; w: number; h: number }) {
  return addNode(doc, makeShapeNode(id, { kind: 'rect', ...rect }, { name: id }));
}

function targetsFor(doc: Document): GuideSnapTarget[] {
  return [...getGuideSnapTargets(doc)];
}

describe('getGuideSnapTargets', () => {
  it('exposes both edges and the center on each axis for a visible object', () => {
    const doc = withRect(createDocument('Guides', true), 'rect', { x: 100, y: 40, w: 200, h: 60 });
    const targets = targetsFor(doc);

    const vertical = targets.filter((t) => t.axis === 'vertical' && t.nodeId === 'rect');
    const horizontal = targets.filter((t) => t.axis === 'horizontal' && t.nodeId === 'rect');

    expect(vertical.map((t) => t.position).sort((a, b) => a - b)).toEqual([100, 200, 300]);
    expect(horizontal.map((t) => t.position).sort((a, b) => a - b)).toEqual([40, 70, 100]);
  });

  it('omits hidden and snap-excluded objects but keeps locked ones', () => {
    let doc = withRect(createDocument('Guides', true), 'visible', { x: 10, y: 10, w: 20, h: 20 });
    doc = addNode(
      doc,
      makeShapeNode('hidden', { kind: 'rect', x: 110, y: 10, w: 20, h: 20 }, { visible: false }),
    );
    doc = addNode(
      doc,
      makeShapeNode('locked', { kind: 'rect', x: 210, y: 10, w: 20, h: 20 }, { locked: true }),
    );
    doc = withRect(doc, 'excluded', { x: 310, y: 10, w: 20, h: 20 });
    doc = setSnapExcluded(doc, 'excluded', true);

    const nodeIds = new Set(targetsFor(doc).map((t) => t.nodeId));

    // Locking protects editing, not visibility: a locked artboard is the most
    // common guide-alignment reference. `snapExcluded` is the opt-out.
    expect([...nodeIds].sort()).toEqual(['locked', 'visible']);
  });

  it('keeps a descendant of a hidden container out of the target set', () => {
    let doc = createDocument('Guides', true);
    doc = addNode(doc, makeFrameNode('frame', { visible: false }));
    doc = addNode(doc, makeShapeNode('child', { kind: 'rect', x: 50, y: 50, w: 10, h: 10 }));
    const child = doc.nodes.child;
    if (!child) throw new Error('expected child node');
    doc = addChild(doc, 'frame', child);

    expect(targetsFor(doc).map((t) => t.nodeId)).not.toContain('child');
  });

  it('restricts targets to the active editing surface when a scope is given', () => {
    const doc = withRect(createDocument('Guides', true), 'in-scope', {
      x: 10,
      y: 10,
      w: 20,
      h: 20,
    });
    const withOther = withRect(doc, 'out-of-scope', { x: 500, y: 10, w: 20, h: 20 });

    const scoped = getGuideSnapTargets(withOther, {
      authoredNodeIds: new Set(['in-scope']),
    });

    expect(new Set(scoped.map((t) => t.nodeId))).toEqual(new Set(['in-scope']));
  });

  it('finds scope nodes that the active page walk never reaches (master edit)', () => {
    // A non-flat document: page content lives under the page's content root,
    // while master content sits under its own root. A master-edit scope points
    // at the master's nodes, so the walk must start from the scope.
    let doc = createDocument('Master edit');
    doc = addNode(doc, makeFrameNode('master-root', { children: [] }));
    doc = addNode(
      doc,
      makeShapeNode('master-child', { kind: 'rect', x: 500, y: 10, w: 20, h: 20 }),
    );
    const child = doc.nodes['master-child'];
    if (!child) throw new Error('expected master child');
    doc = addChild(doc, 'master-root', child);

    expect(getGuideSnapTargets(doc).map((t) => t.nodeId)).not.toContain('master-child');

    const scoped = getGuideSnapTargets(doc, { authoredNodeIds: new Set(['master-child']) });
    expect(scoped.map((t) => t.position)).toContain(500);
  });

  it('picks up a node move because targets are built per call', () => {
    const doc = withRect(createDocument('Guides', true), 'rect', { x: 0, y: 0, w: 10, h: 10 });
    const node = doc.nodes.rect;
    if (node?.kind !== 'shape') throw new Error('expected shape node');
    if (node.shape.kind !== 'rect') throw new Error('expected rect shape');
    const moved: Document = {
      ...doc,
      nodes: { ...doc.nodes, rect: { ...node, shape: { ...node.shape, x: 500 } } },
    };

    expect(getGuideSnapTargets(moved).map((t) => t.position)).toContain(500);
  });
});

describe('snapGuidePosition', () => {
  const targets: GuideSnapTarget[] = [
    { axis: 'vertical', position: 100, nodeId: 'a', kind: 'edge' },
    { axis: 'vertical', position: 104, nodeId: 'b', kind: 'edge' },
    { axis: 'horizontal', position: 100, nodeId: 'a', kind: 'edge' },
  ];

  it('returns the nearest target on the dragged axis inside the tolerance', () => {
    expect(snapGuidePosition(105, 'vertical', targets, 1, 8)?.position).toBe(104);
    expect(snapGuidePosition(96, 'vertical', targets, 1, 8)?.position).toBe(100);
  });

  it('returns null outside the tolerance', () => {
    expect(snapGuidePosition(120, 'vertical', targets, 1, 8)).toBeNull();
  });

  it('measures tolerance in screen pixels, so zooming in tightens the world range', () => {
    expect(snapGuidePosition(112, 'vertical', targets, 4, 8)).toBeNull();
    expect(snapGuidePosition(112, 'vertical', targets, 0.5, 8)?.position).toBe(104);
  });

  it('ignores non-finite positions and degenerate cameras', () => {
    expect(snapGuidePosition(Number.NaN, 'vertical', targets, 1, 8)).toBeNull();
    expect(snapGuidePosition(105, 'vertical', targets, 0, 8)).toBeNull();
    expect(snapGuidePosition(105, 'vertical', targets, 1, 0)).toBeNull();
  });

  it('reports an exact hit as a snap so the caller does not round it away', () => {
    const fractional: GuideSnapTarget[] = [
      { axis: 'vertical', position: 135.4, nodeId: 'a', kind: 'edge' },
    ];
    const hit = snapGuidePosition(135.4, 'vertical', fractional, 1, 8);
    expect(hit).not.toBeNull();
    expect(hit?.position).toBe(135.4);
    expect(hit?.target.nodeId).toBe('a');
  });
});
