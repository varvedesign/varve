import {
  addChild,
  addPage,
  createDesignCanvas,
  createDocument,
  createMaster,
  designCanvasContentRoot,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  type NodeId,
  nextNodeId,
  type Page,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  collectActiveSurfaceNodeIds,
  computeActiveSurfaceLayerCount,
  resolveLayerTreeScope,
} from './layerCounts';
import { DEFAULT_FILTER } from './layerFilterTypes';
import { flattenTree, type LayerTreeScope } from './useFlatTree';

/** Every container expanded, so the unfiltered tree shows the whole scope. */
function allExpanded(doc: { nodes: Record<string, unknown> }): Set<NodeId> {
  return new Set(Object.keys(doc.nodes) as NodeId[]);
}

/**
 * The contract this module exists for: the badge count is the number of rows
 * the tree projects. Any scope that makes these disagree is a defect, which
 * is exactly how isolation and master editing were found.
 */
function expectCountMatchesTree(doc: import('@varve/scene').Document, scope: LayerTreeScope) {
  const rows = flattenTree(
    doc,
    allExpanded(doc),
    DEFAULT_FILTER,
    undefined,
    scope.activePageId,
    scope.isolatedNodeId,
    scope.masterEditId,
    scope.designCanvasId,
  );
  expect(computeActiveSurfaceLayerCount(doc, scope)).toBe(rows.length);
}

describe('computeActiveSurfaceLayerCount', () => {
  it('is 0 for a brand-new blank document (contentRoot is not a layer)', () => {
    const doc = createDocument();
    expect(computeActiveSurfaceLayerCount(doc, { activePageId: doc.activePageId })).toBe(0);
    expectCountMatchesTree(doc, { activePageId: doc.activePageId });
  });

  it('counts only the active page, not other pages in the same document', () => {
    let doc = createDocument();
    const page1ContentRoot = doc.nodes[doc.rootChildren[0]!]!;
    expect(page1ContentRoot.kind).toBe('group');

    const { id: rectId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    doc = addChild(
      doc,
      page1ContentRoot.id,
      makeShapeNode(rectId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    // Add a second page and put two shapes on it.
    doc = addPage(doc, { name: 'Page 2' });
    const page2 = doc.pages?.[1] as Page;
    const { id: rect2Id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addChild(
      doc,
      page2.contentRoot,
      makeShapeNode(rect2Id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    const { id: rect3Id, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addChild(
      doc,
      page2.contentRoot,
      makeShapeNode(rect3Id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    // Still viewing page 1 by default: only the 1 shape on page 1 counts.
    expect(doc.activePageId).toBe(doc.pages?.[0]?.id);
    expect(computeActiveSurfaceLayerCount(doc, { activePageId: doc.activePageId })).toBe(1);
    expectCountMatchesTree(doc, { activePageId: doc.activePageId });

    // Switch to page 2: only its 2 shapes count, not page 1's.
    doc = { ...doc, activePageId: page2.id };
    expect(computeActiveSurfaceLayerCount(doc, { activePageId: doc.activePageId })).toBe(2);
    expectCountMatchesTree(doc, { activePageId: doc.activePageId });
  });

  it('counts nested descendants (group/frame children), recursively', () => {
    let doc = createDocument();
    const page1ContentRoot = doc.nodes[doc.rootChildren[0]!]!;

    const { id: groupId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: childId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(groupId, { name: 'Group', children: [childId] });
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [childId]: makeShapeNode(childId, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
      },
    };
    doc = addChild(doc, page1ContentRoot.id, group);

    // The group itself + its 1 child = 2 layers.
    expect(computeActiveSurfaceLayerCount(doc, { activePageId: doc.activePageId })).toBe(2);
    expect(collectActiveSurfaceNodeIds(doc, { activePageId: doc.activePageId })).toContain(childId);
    expectCountMatchesTree(doc, { activePageId: doc.activePageId });
  });

  it('counts only artwork on the selected Design Canvas', () => {
    let doc = createDesignCanvas(createDocument('design', true), { name: 'Exploration' });
    const firstCanvasId = doc.activeDesignCanvasId!;
    const firstRootId = designCanvasContentRoot(doc)!;
    const firstNode = nextNodeId(doc);
    doc = addChild(
      firstNode.doc,
      firstRootId,
      makeShapeNode(firstNode.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    doc = createDesignCanvas(doc, { name: 'Production' });
    const secondCanvasId = doc.activeDesignCanvasId!;
    const secondRootId = designCanvasContentRoot(doc)!;
    const secondNode = nextNodeId(doc);
    doc = addChild(
      secondNode.doc,
      secondRootId,
      makeShapeNode(secondNode.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    expect(computeActiveSurfaceLayerCount(doc, { designCanvasId: secondCanvasId })).toBe(1);
    expect(collectActiveSurfaceNodeIds(doc, { designCanvasId: firstCanvasId })).toEqual([
      firstNode.id,
    ]);
    expectCountMatchesTree(doc, { designCanvasId: firstCanvasId });
  });

  it('derives the projection scope with the same page-surface rule as the tree', () => {
    const pageDoc = createDocument();
    const printScope = resolveLayerTreeScope(pageDoc, 'print');
    expect(printScope.activePageId).toBe(pageDoc.activePageId);
    expect(printScope.designCanvasId).toBeUndefined();

    const designDoc = createDesignCanvas(createDocument('design', true), { name: 'Canvas' });
    const designScope = resolveLayerTreeScope(designDoc, 'design');
    expect(designScope.designCanvasId).toBe(designDoc.activeDesignCanvasId);
    expect(designScope.activePageId).toBeUndefined();

    const isolated = resolveLayerTreeScope(pageDoc, 'design', 'some-node', 'master-1');
    expect(isolated.isolatedNodeId).toBe('some-node');
    expect(isolated.masterEditId).toBe('master-1');
  });

  it('counts only the isolated subtree the tree shows, not the whole page', () => {
    let doc = createDocument();
    const pageRoot = doc.nodes[doc.rootChildren[0]!]!;

    const frameNext = nextNodeId(doc);
    doc = frameNext.doc;
    const childNext = nextNodeId(doc);
    doc = childNext.doc;
    const frame = makeFrameNode(frameNext.id, {
      name: 'Frame',
      w: 100,
      h: 100,
      children: [childNext.id],
    });
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [childNext.id]: makeShapeNode(childNext.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
      },
    };
    doc = addChild(doc, pageRoot.id, frame);
    const looseNext = nextNodeId(doc);
    doc = addChild(
      looseNext.doc,
      pageRoot.id,
      makeShapeNode(looseNext.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
    );

    const pageScope: LayerTreeScope = { activePageId: doc.activePageId };
    expect(computeActiveSurfaceLayerCount(doc, pageScope)).toBe(3);
    expectCountMatchesTree(doc, pageScope);

    // Isolating the frame narrows rows AND count to the subtree. Before this
    // the badge kept reporting the whole page, so "3 layers" sat above a tree
    // showing two rows and Select matches could claim rows that were not there.
    const isolatedScope: LayerTreeScope = { ...pageScope, isolatedNodeId: frameNext.id };
    expect(computeActiveSurfaceLayerCount(doc, isolatedScope)).toBe(2);
    expectCountMatchesTree(doc, isolatedScope);
  });

  it('counts master source rows during master editing, not page content', () => {
    let doc = createDocument();
    const pageRoot = doc.nodes[doc.rootChildren[0]!]!;

    // Two page layers and one master layer: the page scope and the master
    // scope must each report their own surface.
    for (let i = 0; i < 2; i++) {
      const next = nextNodeId(doc);
      doc = addChild(
        next.doc,
        pageRoot.id,
        makeShapeNode(next.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
      );
    }

    doc = createMaster(doc, { name: 'Master', width: 100, height: 100 });
    const masterId = Object.keys(doc.masters ?? {})[0] as NodeId;
    const masterRootId = doc.masters![masterId]!.contentRoot;
    const masterLayer = nextNodeId(doc);
    doc = addChild(
      masterLayer.doc,
      masterRootId,
      makeShapeNode(masterLayer.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }),
    );

    const pageScope: LayerTreeScope = { activePageId: doc.activePageId };
    expect(computeActiveSurfaceLayerCount(doc, pageScope)).toBe(2);
    expectCountMatchesTree(doc, pageScope);

    const masterScope: LayerTreeScope = { ...pageScope, masterEditId: masterId };
    expect(computeActiveSurfaceLayerCount(doc, masterScope)).toBe(1);
    expectCountMatchesTree(doc, masterScope);
  });
});
