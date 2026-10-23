import type { Shape } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import {
  addChild,
  addPage as addPage2,
  assignMasterToPage,
  createClippingMask,
  createDocument,
  createMaster,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { HitTestEngine } from '..';

function makeDocWithRect(x = 0, y = 0, w = 10, h = 10) {
  let doc = createDocument('test', true);
  const { id: rectId, doc: d1 } = nextNodeId(doc);
  doc = d1;
  const rect = makeShapeNode(
    rectId,
    { kind: 'rect', x: 0, y: 0, w, h },
    { transform: [1, 0, 0, 1, x, y] as Affine },
  );
  doc = { ...doc, nodes: { ...doc.nodes, [rectId]: rect }, rootChildren: [rectId] };
  return { doc, rectId };
}

const OPAQUE_FILL = { space: 'rgb', r: 200, g: 100, b: 50, a: 255 } as ShapeNode['fill'];
const TRANSPARENT_FILL = { space: 'rgb', r: 200, g: 100, b: 50, a: 0 } as ShapeNode['fill'];
/** ~100px inside the bounding box, ~70px from every segment of the outline. */
const INTERIOR = { x: 150, y: 50 };

/**
 * An open path: stroke-only for `shapeContains`, so the bounding box is what
 * decides whether the interior is a target. That makes the paint stack the
 * only thing standing between a hidden fill and a full-bbox click target.
 */
function makeDocWithOpenPath(overrides: Partial<ShapeNode> = {}) {
  let doc = createDocument('test', true);
  const { id, doc: next } = nextNodeId(doc);
  doc = next;
  const shape: Shape = {
    kind: 'path',
    points: [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 200, y: 0, handleIn: null, handleOut: null },
      { x: 200, y: 200, handleIn: null, handleOut: null },
    ],
    closed: false,
    tolerance: 2,
  };
  const base = makeShapeNode(id, shape, { fill: OPAQUE_FILL });
  const node = { ...base, ...overrides } as ShapeNode;
  doc = { ...doc, nodes: { ...doc.nodes, [id]: node }, rootChildren: [id] };
  return { doc, pathId: id };
}

/**
 * A click target has to correspond to painted pixels. The bbox fallback is
 * deliberately generous for shapes whose fill is transparent, but a fill that
 * is hidden or fully transparent paints nothing, and hidden geometry must not
 * stay reachable by clicking (GraphiteEditor/Graphite#2554).
 */
describe('HitTestEngine paint-aware click targets', () => {
  it('keeps the generous target for a shape that paints a fill', () => {
    const { doc, pathId } = makeDocWithOpenPath();
    expect(new HitTestEngine(doc).hitTest(INTERIOR)?.nodeId).toBe(pathId);
  });

  it('drops the target when the only fill is hidden', () => {
    const { doc } = makeDocWithOpenPath({
      fills: [
        { type: 'solid', color: OPAQUE_FILL, opacity: 1, blendMode: 'normal', visible: false },
      ],
    } as Partial<ShapeNode>);
    expect(new HitTestEngine(doc).hitTest(INTERIOR)).toBeNull();
    // The outline itself is still painted, so it stays a target.
    expect(new HitTestEngine(doc).hitTest({ x: 100, y: 0 })).not.toBeNull();
  });

  it('drops the target when the fill stack is fully transparent', () => {
    const { doc } = makeDocWithOpenPath({
      fills: [
        { type: 'solid', color: TRANSPARENT_FILL, opacity: 1, blendMode: 'normal', visible: true },
      ],
    } as Partial<ShapeNode>);
    expect(new HitTestEngine(doc).hitTest(INTERIOR)).toBeNull();
  });

  it('resolves paint references before deciding', () => {
    const { doc, pathId } = makeDocWithOpenPath({ paintRefs: ['paint-1'] });
    const hiddenPaint = {
      id: 'paint-1',
      name: 'Hidden',
      fill: {
        type: 'solid' as const,
        color: OPAQUE_FILL,
        opacity: 1,
        blendMode: 'normal' as const,
        visible: false,
      },
    };
    const withHidden = { ...doc, paints: { 'paint-1': hiddenPaint } };
    expect(new HitTestEngine(withHidden).hitTest(INTERIOR)).toBeNull();

    const withVisible = {
      ...doc,
      paints: { 'paint-1': { ...hiddenPaint, fill: { ...hiddenPaint.fill, visible: true } } },
    };
    expect(new HitTestEngine(withVisible).hitTest(INTERIOR)?.nodeId).toBe(pathId);
  });
});

describe('HitTestEngine stroke-aware click targets', () => {
  const STROKE = {
    id: 's1',
    color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    weight: 40,
    dashPattern: [] as number[],
    dashOffset: 0,
    cap: 'butt' as const,
    join: 'miter' as const,
    miterLimit: 4,
    visible: true,
  };

  function makeStrokedRect(align: 'inside' | 'center' | 'outside', visible = true) {
    let doc = createDocument('test', true);
    const { id, doc: next } = nextNodeId(doc);
    doc = next;
    const built = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    // `makeShapeNode` drops fields it does not declare, so the stroke stack is
    // set on the built node rather than passed in the overrides.
    const node = {
      ...built,
      fill: OPAQUE_FILL,
      fills: [] as ShapeNode['fills'],
      strokes: [{ ...STROKE, align, visible }],
    } as ShapeNode;
    doc = { ...doc, nodes: { ...doc.nodes, [id]: node }, rootChildren: [id] };
    return { doc, id };
  }

  it('picks the band an outside-aligned stroke paints', () => {
    const { doc, id } = makeStrokedRect('outside');
    // 30 world units outside the rect edge: painted by a 40 px outside stroke
    // but far past the 8 px screen tolerance.
    expect(new HitTestEngine(doc).hitTest({ x: 130, y: 50 })?.nodeId).toBe(id);
  });

  it('does not extend the target for an inside-aligned stroke', () => {
    const { doc } = makeStrokedRect('inside');
    expect(new HitTestEngine(doc).hitTest({ x: 130, y: 50 })).toBeNull();
  });

  it('uses half the weight for a centre-aligned stroke', () => {
    const { doc, id } = makeStrokedRect('center');
    expect(new HitTestEngine(doc).hitTest({ x: 115, y: 50 })?.nodeId).toBe(id);
    // 30 units out is beyond the 20 units of painted band plus tolerance.
    expect(new HitTestEngine(doc).hitTest({ x: 132, y: 50 })).toBeNull();
  });

  it('ignores a hidden stroke', () => {
    const { doc } = makeStrokedRect('outside', false);
    expect(new HitTestEngine(doc).hitTest({ x: 130, y: 50 })).toBeNull();
  });

  it('scales the painted band with the node transform', () => {
    let doc = createDocument('test', true);
    const { id, doc: next } = nextNodeId(doc);
    doc = next;
    const built = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      {
        transform: [2, 0, 0, 2, 0, 0] as Affine,
      },
    );
    const node = {
      ...built,
      fill: OPAQUE_FILL,
      fills: [] as ShapeNode['fills'],
      strokes: [{ ...STROKE, align: 'outside' }],
    } as ShapeNode;
    doc = { ...doc, nodes: { ...doc.nodes, [id]: node }, rootChildren: [id] };
    // The edge is at x=200 and the 40 px stroke becomes 80 world units.
    expect(new HitTestEngine(doc).hitTest({ x: 250, y: 100 })?.nodeId).toBe(id);
  });

  it('follows an open path with a half-weight band', () => {
    let doc = createDocument('test', true);
    const { id, doc: next } = nextNodeId(doc);
    doc = next;
    const built = makeShapeNode(id, {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 0, handleIn: null, handleOut: null },
      ],
      closed: false,
      tolerance: 2,
    });
    const node = {
      ...built,
      fill: TRANSPARENT_FILL,
      fills: [] as ShapeNode['fills'],
      strokes: [{ ...STROKE, align: 'outside' }],
    } as ShapeNode;
    doc = { ...doc, nodes: { ...doc.nodes, [id]: node }, rootChildren: [id] };
    // An open path has no interior, so every alignment straddles the line and
    // paints half the weight per side.
    expect(new HitTestEngine(doc).hitTest({ x: 100, y: 18 })?.nodeId).toBe(id);
    expect(new HitTestEngine(doc).hitTest({ x: 100, y: 32 })).toBeNull();
  });
});

describe('HitTestEngine', () => {
  it('returns null for an empty document', () => {
    const doc = createDocument('test', true);
    const engine = new HitTestEngine(doc);
    expect(engine.hitTest({ x: 0, y: 0 })).toBeNull();
  });

  it('hits a single rect', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new HitTestEngine(doc);
    const hit = engine.hitTest({ x: 5, y: 5 });
    expect(hit).not.toBeNull();
    expect(hit?.nodeId).toBe(rectId);
  });

  it('returns null when point is outside the rect', () => {
    const { doc } = makeDocWithRect(0, 0, 10, 10);
    const engine = new HitTestEngine(doc);
    expect(engine.hitTest({ x: 20, y: 20 })).toBeNull();
  });

  it('skips locked nodes', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const locked = { ...doc.nodes[rectId]!, locked: true };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [rectId]: locked } };
    const engine = new HitTestEngine(doc2);
    expect(engine.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('skips invisible nodes', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const hidden = { ...doc.nodes[rectId]!, visible: false };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [rectId]: hidden } };
    const engine = new HitTestEngine(doc2);
    expect(engine.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('returns topmost node for overlapping shapes', () => {
    let doc = createDocument('test', true);
    const { id: aId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: bId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = makeShapeNode(
      aId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    const b = makeShapeNode(
      bId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 2, 2] as Affine },
    );
    doc = { ...doc, nodes: { ...doc.nodes, [aId]: a, [bId]: b }, rootChildren: [aId, bId] };
    const engine = new HitTestEngine(doc);
    const hit = engine.hitTest({ x: 5, y: 5 });
    expect(hit?.nodeId).toBe(bId);
  });

  it('finds all nodes at a point in paint order (topmost last)', () => {
    let doc = createDocument('test', true);
    const { id: aId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: bId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = makeShapeNode(
      aId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    const b = makeShapeNode(
      bId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    doc = { ...doc, nodes: { ...doc.nodes, [aId]: a, [bId]: b }, rootChildren: [aId, bId] };
    const engine = new HitTestEngine(doc);
    const all = engine.findNodesAtPoint({ x: 5, y: 5 });
    expect(all.map((n) => n.nodeId)).toEqual([bId, aId]);
  });

  it('respects isolation mode', () => {
    let doc = createDocument('test', true);
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: rectId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [rectId],
    });
    const rect = makeShapeNode(
      rectId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 5, 5] as Affine },
    );
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, [rectId]: rect },
      rootChildren: [frameId],
    };
    const engine = new HitTestEngine(doc, { isolatedNodeId: rectId });
    const hit = engine.hitTest({ x: 7, y: 7 });
    expect(hit?.nodeId).toBe(rectId);

    const engine2 = new HitTestEngine(doc, { isolatedNodeId: frameId });
    expect(engine2.hitTest({ x: 50, y: 50 })?.nodeId).toBe(frameId);
  });

  it('does not hit clipped content outside the mask geometry', () => {
    let doc = createDocument('test', true);
    const maskId = 'mask';
    const contentId = 'content';
    doc = {
      ...doc,
      nodes: {
        [maskId]: makeShapeNode(maskId, { kind: 'circle', cx: 10, cy: 10, r: 10 }),
        [contentId]: makeShapeNode(contentId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      },
      rootChildren: [maskId, contentId],
    };
    doc = createClippingMask(doc, maskId, [contentId]).doc;

    const engine = new HitTestEngine(doc, { zoom: 100 });
    expect(engine.hitTest({ x: 10, y: 10 })?.nodeId).toBeTruthy();
    expect(engine.hitTest({ x: 80, y: 80 })).toBeNull();
  });

  it('deepSelect returns deepest non-container child instead of parent container', () => {
    let doc = createDocument('test', true);
    // Create child rect before frame so frameId is larger (later in paint order)
    const { id: rectId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const rect = makeShapeNode(
      rectId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 5, 5] as Affine },
    );
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [rectId],
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, [rectId]: rect },
      rootChildren: [frameId],
    };
    // Without deepSelect: returns the frame (topmost)
    const normal = new HitTestEngine(doc);
    const normalHit = normal.hitTest({ x: 7, y: 7 });
    expect(normalHit?.nodeId).toBeDefined();
    // With deepSelect: returns the child rect (deepest non-container)
    const deep = new HitTestEngine(doc, { deepSelect: true });
    const deepHit = deep.hitTest({ x: 7, y: 7 });
    expect(deepHit?.nodeId).toBe(rectId);
  });

  it('deepSelect returns container when no non-container child is hit', () => {
    let doc = createDocument('test', true);
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [],
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame },
      rootChildren: [frameId],
    };
    // No children, so deepSelect falls back to the container
    const engine = new HitTestEngine(doc, { deepSelect: true });
    expect(engine.hitTest({ x: 50, y: 50 })?.nodeId).toBe(frameId);
  });

  it('honours compound-path holes and inverted clipping during hit testing', () => {
    let doc = createDocument('test', true);
    const maskId = 'mask';
    const contentId = 'content';
    const ring = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0, handleIn: null, handleOut: null },
      { x: x1, y: y0, handleIn: null, handleOut: null },
      { x: x1, y: y1, handleIn: null, handleOut: null },
      { x: x0, y: y1, handleIn: null, handleOut: null },
    ];
    doc = {
      ...doc,
      nodes: {
        [maskId]: makeShapeNode(maskId, {
          kind: 'path',
          points: ring(0, 0, 100, 100),
          holes: [ring(25, 25, 75, 75)],
          closed: true,
          tolerance: 1,
          fillRule: 'evenodd',
        }),
        [contentId]: makeShapeNode(contentId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      },
      rootChildren: [maskId, contentId],
    };
    doc = createClippingMask(doc, maskId, [contentId]).doc;
    const groupId = doc.rootChildren[0]!;
    const engine = new HitTestEngine(doc, { zoom: 100 });
    expect(engine.hitTest({ x: 10, y: 10 })?.nodeId).toBeTruthy();
    expect(engine.hitTest({ x: 50, y: 50 })).toBeNull();

    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [groupId]: {
          ...doc.nodes[groupId]!,
          mask: { ...doc.nodes[groupId]!.mask!, inverted: true },
        },
      },
    };
    const inverted = new HitTestEngine(doc, { zoom: 100 });
    expect(inverted.hitTest({ x: 10, y: 10 })).toBeNull();
    expect(inverted.hitTest({ x: 50, y: 50 })?.nodeId).toBeTruthy();
  });

  describe('scaling with overlapping candidates', () => {
    /** N overlapping rects at the same point -- all survive spatial filtering. */
    function makeStackedDoc(count: number) {
      let doc = createDocument('test', true);
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const { id, doc: d1 } = nextNodeId(doc);
        doc = d1;
        const rect = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, {});
        doc = { ...doc, nodes: { ...doc.nodes, [id]: rect } };
        ids.push(id);
      }
      return { ...doc, rootChildren: ids };
    }

    it('hitTest scales near-linearly with candidate count, not quadratically', {
      timeout: 60_000,
    }, () => {
      // 60s timeout: this is a ratio guard (largeMs < smallMs*20), not an
      // absolute-time guard; on loaded CI/parallel-agent hosts the doc setup
      // (2400 nodes) alone can exceed vitest's 5s default.
      // Regression guard: hitTest()/findNodesAtPoint() call nodeWorldTransform/
      // nodeWorldBounds once per candidate without the engine's own
      // `this.parentIndex` (built once in the constructor for exactly this
      // purpose, but left unwired at these call sites) -- so each candidate
      // fell back to an O(n) linear scan (getParent), making a single
      // hitTest() call O(candidates^2) when most nodes overlap the query
      // point. 8x nodes should cost nowhere near 8x^2 = 64x time.
      const small = makeStackedDoc(300);
      const large = makeStackedDoc(2400); // 8x

      const engineSmall = new HitTestEngine(small);
      const t0 = performance.now();
      engineSmall.hitTest({ x: 5, y: 5 });
      const smallMs = performance.now() - t0;

      const engineLarge = new HitTestEngine(large);
      const t1 = performance.now();
      engineLarge.hitTest({ x: 5, y: 5 });
      const largeMs = performance.now() - t1;

      expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 200));
    });

    it('findNodesAtPoint scales near-linearly with candidate count, not quadratically', {
      timeout: 60_000,
    }, () => {
      // 60s timeout: same rationale as the hitTest ratio guard above.
      const small = makeStackedDoc(300);
      const large = makeStackedDoc(2400);

      const engineSmall = new HitTestEngine(small);
      const t0 = performance.now();
      engineSmall.findNodesAtPoint({ x: 5, y: 5 });
      const smallMs = performance.now() - t0;

      const engineLarge = new HitTestEngine(large);
      const t1 = performance.now();
      engineLarge.findNodesAtPoint({ x: 5, y: 5 });
      const largeMs = performance.now() - t1;

      expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 200));
    });
  });

  describe('cross-page hit testing (ADR-0144 shared canvas)', () => {
    it('hits content on any placed page, not just the active page', () => {
      let doc = createDocument('test', false);
      // Two pages with explicit placements, page 2 inactive.
      const [p1] = [doc.pages![0]!];
      const { doc: d1 } = nextNodeId(doc);
      doc = addPage2(d1);
      const [p1b, p2] = [doc.pages![0]!, doc.pages![1]!];
      doc = {
        ...doc,
        pages: [
          { ...p1b, placement: { x: 0, y: 0 } },
          { ...p2, placement: { x: 220, y: 0 } },
        ],
      };
      void p1;

      // Shape on page 1 at page-local (10,10) and shape on page 2 at (10,10).
      const { id: shapeA, doc: d2 } = nextNodeId(doc);
      doc = addChild(
        d2,
        p1b.contentRoot,
        makeShapeNode(
          shapeA,
          { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );
      const { id: shapeB, doc: d3 } = nextNodeId(doc);
      doc = addChild(
        d3,
        p2.contentRoot,
        makeShapeNode(
          shapeB,
          { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );

      const engine = new HitTestEngine(doc);
      // World point inside page 2's placed bounds (page-local 30,30).
      const hit = engine.hitTest({ x: 220 + 30, y: 30 });
      expect(hit?.nodeId).toBe(shapeB);
      // Active page stays page 1 — hit testing is not gated on it.
      expect(doc.activePageId).toBe(p1b.id);
      // Pasteboard point between pages hits nothing.
      expect(engine.hitTest({ x: 210, y: 30 })).toBeNull();
    });

    it('hits projected master content at the page placement', () => {
      let doc = createDocument('master hit', false);
      doc = createMaster(doc, { name: 'Master', width: 1920, height: 1080 });
      const master = Object.values(doc.masters!)[0]!;
      const { id: headerId, doc: d1 } = nextNodeId(doc);
      doc = addChild(
        d1,
        master.contentRoot,
        makeShapeNode(
          headerId,
          { kind: 'rect', x: 0, y: 0, w: 100, h: 20 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );
      const page = doc.pages![0]!;
      doc = {
        ...doc,
        pages: [{ ...page, placement: { x: 220, y: 40 } }],
      };
      doc = assignMasterToPage(doc, page.id, master.id);

      const engine = new HitTestEngine(doc);
      expect(engine.hitTest({ x: 230, y: 50 })?.nodeId).toBe(headerId);
      expect(engine.hitTest({ x: 10, y: 10 })).toBeNull();
    });

    it('hits the same master source at every assigned page placement', () => {
      let doc = createDocument('repeated master hit', false);
      doc = createMaster(doc, { name: 'Master', width: 1920, height: 1080 });
      const master = Object.values(doc.masters!)[0]!;
      const { id: sourceId, doc: d1 } = nextNodeId(doc);
      doc = addChild(
        d1,
        master.contentRoot,
        makeShapeNode(
          sourceId,
          { kind: 'rect', x: 0, y: 0, w: 100, h: 20 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );
      doc = addPage2(doc, { width: 1920, height: 1080 });
      const [firstPage, secondPage] = doc.pages!;
      doc = {
        ...doc,
        pages: [
          { ...firstPage!, placement: { x: 100, y: 40 } },
          { ...secondPage!, placement: { x: 500, y: 40 } },
        ],
      };
      doc = assignMasterToPage(doc, firstPage!.id, master.id);
      doc = assignMasterToPage(doc, secondPage!.id, master.id);

      const engine = new HitTestEngine(doc);
      expect(engine.hitTest({ x: 120, y: 60 })?.nodeId).toBe(sourceId);
      expect(engine.hitTest({ x: 520, y: 60 })?.nodeId).toBe(sourceId);
      expect(engine.hitTest({ x: 20, y: 20 })).toBeNull();
    });

    it('uses the active page placement while editing a master source', () => {
      let doc = createDocument('master source hit', false);
      doc = createMaster(doc, { name: 'Master', width: 1920, height: 1080 });
      const master = Object.values(doc.masters!)[0]!;
      const { id: sourceId, doc: d1 } = nextNodeId(doc);
      doc = addChild(
        d1,
        master.contentRoot,
        makeShapeNode(sourceId, { kind: 'rect', x: 0, y: 0, w: 100, h: 20 }),
      );
      const page = doc.pages![0]!;
      doc = {
        ...doc,
        pages: [{ ...page, placement: { x: 300, y: 60 } }],
      };
      doc = assignMasterToPage(doc, page.id, master.id);

      const engine = new HitTestEngine(doc, { masterEditId: master.id });
      expect(engine.hitTest({ x: 350, y: 70 })?.nodeId).toBe(sourceId);
      expect(engine.hitTest({ x: 50, y: 10 })).toBeNull();
    });
  });
});

describe('HitTestEngine document structure reuse', () => {
  it('never serves a previous document revision after an immutable move', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    expect(new HitTestEngine(doc).hitTest({ x: 5, y: 5 })?.nodeId).toBe(rectId);
    // Repeated engines over the same committed document (the hover path).
    expect(new HitTestEngine(doc).hitTest({ x: 5, y: 5 })?.nodeId).toBe(rectId);

    const moved = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [rectId]: { ...doc.nodes[rectId]!, transform: [1, 0, 0, 1, 500, 500] as Affine },
      },
    };
    const engine = new HitTestEngine(moved);
    expect(engine.hitTest({ x: 5, y: 5 })).toBeNull();
    expect(engine.hitTest({ x: 505, y: 505 })?.nodeId).toBe(rectId);
    // The older revision is still answered from its own geometry.
    expect(new HitTestEngine(doc).hitTest({ x: 5, y: 5 })?.nodeId).toBe(rectId);
  });

  it('finds the same target far zoomed out, where the occupied-cell scan applies', () => {
    const { doc, rectId } = makeDocWithRect(10_000, 10_000, 10, 10);
    // At 0.1% zoom the tolerance square spans thousands of 64-unit cells,
    // far more than the single occupied cell in this document.
    const far = new HitTestEngine(doc, { zoom: 0.001 });
    expect(far.hitTest({ x: 10_005, y: 10_005 })?.nodeId).toBe(rectId);
    expect(far.hitTest({ x: -50_000, y: -50_000 })).toBeNull();
    const near = new HitTestEngine(doc, { zoom: 1 });
    expect(near.hitTest({ x: 10_005, y: 10_005 })?.nodeId).toBe(rectId);
  });
});
