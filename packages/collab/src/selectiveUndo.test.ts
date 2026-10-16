import {
  applyOperation,
  type CapturedChange,
  canonicalHistoryHash,
  createDocument,
  type Document,
  makeShapeNode,
  makeTextNode,
  type NodeId,
  registerBuiltinOperations,
  type SceneNode,
  type ShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  computeRedoCompensation,
  computeStepCompensation,
  type LocalCaptureStep,
} from './selectiveUndo';

registerBuiltinOperations();

// ── Fixtures ──────────────────────────────────────────────────────────────────

let txCounter = 0;

function rect(id: NodeId, x: number, fill: string): ShapeNode {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
    {
      name: id,
      transform: [1, 0, 0, 1, x, 10],
      fill: hex(fill),
    },
  );
}

function hex(rgb: string): ShapeNode['fill'] {
  const value = Number.parseInt(rgb.slice(1), 16);
  return { space: 'rgb', r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: 255 };
}

function docWith(...nodes: ShapeNode[]): Document {
  const doc = createDocument('collab-test', true);
  const map: Record<NodeId, ShapeNode> = {};
  for (const node of nodes) map[node.id] = node;
  return {
    ...doc,
    rootChildren: nodes.map((n) => n.id),
    nodes: map,
  };
}

function move(doc: Document, id: NodeId, x: number): Document {
  const node = doc.nodes[id] as ShapeNode;
  return {
    ...doc,
    nodes: { ...doc.nodes, [id]: { ...node, transform: [1, 0, 0, 1, x, 10] } },
  };
}

function setFill(doc: Document, id: NodeId, color: string): Document {
  const node = doc.nodes[id] as ShapeNode;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, fill: hex(color) } } };
}

function setOpacity(doc: Document, id: NodeId, opacity: number): Document {
  const node = doc.nodes[id] as ShapeNode;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, opacity } } };
}

function addNode(doc: Document, node: ShapeNode): Document {
  return {
    ...doc,
    rootChildren: [...doc.rootChildren, node.id],
    nodes: { ...doc.nodes, [node.id]: node },
  };
}

function removeNode(doc: Document, id: NodeId): Document {
  const nodes = { ...doc.nodes };
  delete nodes[id];
  return { ...doc, rootChildren: doc.rootChildren.filter((n) => n !== id), nodes };
}

function setText(doc: Document, id: NodeId, text: string): Document {
  const node = doc.nodes[id] as SceneNode;
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...node, text } as SceneNode } };
}

/**
 * Hand-built captures in the exact `document.transaction-capture` payload
 * schema (same shape the history differ produces; differ-parity through the
 * compensation engine is exercised by the editor integration suite, where
 * @varve/editor depends on @varve/history).
 */
function captureOf(before: Document, after: Document, changes: CapturedChange[]): LocalCaptureStep {
  txCounter += 1;
  return {
    revisionId: `rev-${txCounter}`,
    clientOpId: `op-${txCounter}`,
    capture: {
      transactionId: `tx-${txCounter}`,
      changes,
      summary: {
        label: 'Edit',
        affectedEntityIds: [...new Set(changes.map((c) => c.entityId))],
        kind: 'modify',
      },
      beforeHash: canonicalHistoryHash(before),
      afterHash: canonicalHistoryHash(after),
    },
  };
}

function moveCapture(before: Document, after: Document, id: NodeId): LocalCaptureStep {
  const b = before.nodes[id] as ShapeNode;
  const a = after.nodes[id] as ShapeNode;
  return captureOf(before, after, [
    {
      changeType: 'reordered',
      entityId: id,
      entityType: 'node',
      propertyPath: `nodes.${id}.transform`,
      before: b.transform,
      after: a.transform,
      summary: `Node "${id}": transform changed`,
    },
  ]);
}

function propertyCapture(
  before: Document,
  after: Document,
  id: NodeId,
  property: string,
  value: unknown,
): LocalCaptureStep {
  const b = before.nodes[id] as unknown as Record<string, unknown>;
  return captureOf(before, after, [
    {
      changeType: 'modified',
      entityId: id,
      entityType: 'node',
      propertyPath: `nodes.${id}.${property}`,
      before: b[property],
      after: value,
      summary: `Node "${id}": ${property} changed`,
    },
  ]);
}

function createCapture(before: Document, added: ShapeNode): LocalCaptureStep {
  return captureOf(before, addNode(before, added), [
    {
      changeType: 'added',
      entityId: added.id,
      entityType: 'node',
      propertyPath: 'nodes',
      after: added,
      summary: `Node "${added.id}" added`,
    },
    {
      changeType: 'reordered',
      entityId: 'document',
      entityType: 'document',
      propertyPath: 'rootChildren',
      before: before.rootChildren,
      after: [...before.rootChildren, added.id],
      summary: 'Document: rootChildren array changed',
    },
  ]);
}

function deleteCapture(before: Document, id: NodeId): LocalCaptureStep {
  return captureOf(before, removeNode(before, id), [
    {
      changeType: 'removed',
      entityId: id,
      entityType: 'node',
      propertyPath: 'nodes',
      before: before.nodes[id],
      summary: `Node "${id}" removed`,
    },
    {
      changeType: 'reordered',
      entityId: 'document',
      entityType: 'document',
      propertyPath: 'rootChildren',
      before: before.rootChildren,
      after: before.rootChildren.filter((n) => n !== id),
      summary: 'Document: rootChildren array changed',
    },
  ]);
}

function textCapture(
  before: Document,
  id: NodeId,
  baseText: string,
  afterText: string,
  ranges: { baseStart: number; baseEnd: number; targetStart: number; targetEnd: number },
): LocalCaptureStep {
  return captureOf(before, setText(before, id, afterText), [
    {
      changeType: 'text',
      entityId: id,
      entityType: 'node',
      propertyPath: `nodes.${id}.text`,
      before: baseText,
      after: afterText,
      textRanges: ranges,
      summary: `Text changed (${ranges.baseEnd - ranges.baseStart + (ranges.targetEnd - ranges.targetStart)} clusters affected)`,
    },
  ]);
}

/** Apply a capture through the real operation registry (remote-apply parity). */
function applyCapture(doc: Document, capture: LocalCaptureStep['capture']): Document {
  return applyOperation(doc, 'document.transaction-capture', capture);
}

function applyCompensation(
  doc: Document,
  changes: NonNullable<ReturnType<typeof computeStepCompensation>['changes']>,
): Document {
  txCounter += 1;
  return applyOperation(doc, 'document.transaction-capture', {
    transactionId: `tx-comp-${txCounter}`,
    changes,
    summary: {
      label: 'Undo',
      affectedEntityIds: [...new Set(changes.map((c) => c.entityId))],
      kind: 'modify',
    },
    beforeHash: canonicalHistoryHash(doc),
    afterHash: '0'.repeat(64),
  });
}

function prop(doc: Document, id: NodeId, path: string): unknown {
  const node = doc.nodes[id] as unknown as Record<string, unknown>;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, node);
}

// ── Release-blocking scenarios ────────────────────────────────────────────────

describe('selective undo compensation', () => {
  it('A moves an object, B recolors it, A undoes: B color survives, position reverts', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const doc1 = move(doc0, 'a', 100); // A moves the object
    const doc2 = setFill(doc1, 'a', '#00ff00'); // B recolors it (remote, applied after)

    const stepA = moveCapture(doc0, doc1, 'a');
    const stepB = propertyCapture(doc1, doc2, 'a', 'fill', hex('#00ff00'));
    const current = applyCapture(applyCapture(doc0, stepA.capture), stepB.capture);

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('full');
    const undone = applyCompensation(current, compensation.changes);

    expect(prop(undone, 'a', 'fill')).toEqual(hex('#00ff00')); // B's intent kept
    expect((undone.nodes.a as ShapeNode).transform[4]).toBe(0); // A's move reverted
  });

  it('A changes a property, B changes the same property, A undoes: B intent kept, no-op with reason', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const doc1 = setOpacity(doc0, 'a', 0.5); // A
    const doc2 = setOpacity(doc1, 'a', 0.8); // B, later

    const stepA = propertyCapture(doc0, doc1, 'a', 'opacity', 0.5);
    const stepB = propertyCapture(doc1, doc2, 'a', 'opacity', 0.8);
    const current = applyCapture(applyCapture(doc0, stepA.capture), stepB.capture);

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('no-op');
    expect(compensation.skips[0]?.reason).toBe('superseded');
    expect(prop(current, 'a', 'opacity')).toBe(0.8);
  });

  it('A creates an object, B edits it, A undoes the creation: object survives with B edits', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const created = rect('b', 300, '#0000ff');
    const doc1 = addNode(doc0, created); // A creates
    const doc2 = setFill(doc1, 'b', '#00ff00'); // B edits A's new object

    const stepA = createCapture(doc0, created);
    const stepB = propertyCapture(doc1, doc2, 'b', 'fill', hex('#00ff00'));
    const current = applyCapture(applyCapture(doc0, stepA.capture), stepB.capture);

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('no-op');
    // Both the entity removal and the membership reorder are guarded.
    expect(compensation.skips.map((s) => s.reason).sort()).toEqual([
      'modified-by-others',
      'order-changed',
    ]);
    expect(current.nodes.b).toBeDefined();
    expect(prop(current, 'b', 'fill')).toEqual(hex('#00ff00'));
  });

  it('A creates an untouched object, A undoes: object removed', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const stepA = createCapture(doc0, rect('b', 300, '#0000ff'));
    const current = applyCapture(doc0, stepA.capture);
    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('full');
    const undone = applyCompensation(current, compensation.changes);
    expect(undone.nodes.b).toBeUndefined();
    expect(undone.rootChildren).not.toContain('b');
  });

  it('A deletes an object, B edits another, A undoes: full object restored from A step', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'), rect('b', 300, '#0000ff'));
    const doc1 = removeNode(doc0, 'a'); // A deletes
    const doc2 = setFill(doc1, 'b', '#00ff00'); // B edits the other object

    const stepA = deleteCapture(doc0, 'a');
    const stepB = propertyCapture(doc1, doc2, 'b', 'fill', hex('#00ff00'));
    const current = applyCapture(applyCapture(doc0, stepA.capture), stepB.capture);

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('full');
    const undone = applyCompensation(current, compensation.changes);
    expect(undone.nodes.a).toBeDefined();
    expect(prop(undone, 'a', 'fill')).toEqual(hex('#ff0000'));
    expect(prop(undone, 'b', 'fill')).toEqual(hex('#00ff00'));
    expect(undone.rootChildren).toContain('a');
  });

  it('multi-step undo walks newest-first and redo reapplies', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const doc1 = move(doc0, 'a', 50); // step 1
    const doc2 = move(doc1, 'a', 100); // step 2
    const step1 = moveCapture(doc0, doc1, 'a');
    const step2 = moveCapture(doc1, doc2, 'a');
    const current = applyCapture(applyCapture(doc0, step1.capture), step2.capture);

    const comp2 = computeStepCompensation(current, step2);
    const afterUndo2 = applyCompensation(current, comp2.changes);
    expect((afterUndo2.nodes.a as ShapeNode).transform[4]).toBe(50);

    const comp1 = computeStepCompensation(afterUndo2, step1);
    const afterUndo1 = applyCompensation(afterUndo2, comp1.changes);
    expect((afterUndo1.nodes.a as ShapeNode).transform[4]).toBe(0);

    // Redo step 1: transform returns to 50.
    const redo1 = computeRedoCompensation(afterUndo1, {
      step: step1,
      compensation: {
        transactionId: 'tx-comp',
        changes: comp1.changes,
        summary: { label: 'Undo', affectedEntityIds: ['a'], kind: 'modify' },
        beforeHash: canonicalHistoryHash(afterUndo2),
        afterHash: canonicalHistoryHash(afterUndo1),
      },
    });
    expect(redo1.changes.length).toBeGreaterThan(0);
    const afterRedo1 = applyCompensation(afterUndo1, redo1.changes);
    expect((afterRedo1.nodes.a as ShapeNode).transform[4]).toBe(50);
  });

  it('redo after an intervening remote change skips the superseded property', () => {
    const doc0 = docWith(rect('a', 0, '#ff0000'));
    const doc1 = move(doc0, 'a', 50); // A moves
    const stepA = moveCapture(doc0, doc1, 'a');
    const afterA = applyCapture(doc0, stepA.capture);

    const compensation = computeStepCompensation(afterA, stepA);
    const afterUndo = applyCompensation(afterA, compensation.changes);
    expect((afterUndo.nodes.a as ShapeNode).transform[4]).toBe(0);

    // B moves the object somewhere new before A redoes.
    const afterB = move(afterUndo, 'a', 500);
    const redo = computeRedoCompensation(afterB, {
      step: stepA,
      compensation: {
        transactionId: 'tx-comp',
        changes: compensation.changes,
        summary: { label: 'Undo', affectedEntityIds: ['a'], kind: 'modify' },
        beforeHash: canonicalHistoryHash(afterA),
        afterHash: canonicalHistoryHash(afterUndo),
      },
    });
    expect(redo.kind).toBe('no-op');
    expect(redo.skips[0]?.reason).toBe('superseded');
  });

  it('disjoint concurrent text edits: undo of one keeps the other', () => {
    const doc0 = docWith(makeTextNode('t', 'hello world') as unknown as ShapeNode);
    // A types "brave " after "hello "; B (concurrently, same base) types
    // "there " at the same point. A's site received B's op first (B has the
    // lower room sequence), so A's current text holds both inserts.
    const docA = setText(doc0, 't', 'hello brave world');
    const stepA = textCapture(doc0, 't', 'hello world', 'hello brave world', {
      baseStart: 6,
      baseEnd: 6,
      targetStart: 6,
      targetEnd: 12,
    });
    const current = setText(docA, 't', 'hello brave there world');

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('full');
    const undone = applyCompensation(current, compensation.changes);
    expect((undone.nodes.t as unknown as { text: string }).text).toBe('hello there world');
  });

  it('undo when the local insert never landed (superseded by concurrent same-point edit) skips cleanly', () => {
    const doc0 = docWith(makeTextNode('t', 'hello world') as unknown as ShapeNode);
    const stepA = textCapture(doc0, 't', 'hello world', 'hello brave world', {
      baseStart: 6,
      baseEnd: 6,
      targetStart: 6,
      targetEnd: 12,
    });
    void setText(doc0, 't', 'hello brave world'); // A's own site state
    // A's text never reached this site; B's insert occupies the point.
    const current = setText(doc0, 't', 'hello there world');

    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('no-op');
    expect(compensation.skips[0]?.reason).toBe('text-overlap');
  });

  it('overlapping concurrent text edits: undo skips with text-overlap, no clobber', () => {
    const doc0 = docWith(makeTextNode('t', 'hello world') as unknown as ShapeNode);
    // Both replace "hello" concurrently; B's version is current (later room order).
    const docB = setText(doc0, 't', 'yo world');
    const stepA = textCapture(doc0, 't', 'hello world', 'HEY world', {
      baseStart: 0,
      baseEnd: 5,
      targetStart: 0,
      targetEnd: 3,
    });

    const compensation = computeStepCompensation(docB, stepA);
    expect(compensation.kind).toBe('no-op');
    expect(compensation.skips[0]?.reason).toBe('text-overlap');
  });

  it('text undo transforms around a remote edit that shifted positions', () => {
    const doc0 = docWith(makeTextNode('t', 'hello world') as unknown as ShapeNode);
    const stepA = textCapture(doc0, 't', 'hello world', 'hello brave world', {
      baseStart: 6,
      baseEnd: 6,
      targetStart: 6,
      targetEnd: 12,
    }); // A edits

    // After A's edit, B prepends a word (edit at position 0, before A's range).
    const docA = setText(doc0, 't', 'hello brave world');
    const current = setText(docA, 't', 'oh my hello brave world');
    const compensation = computeStepCompensation(current, stepA);
    expect(compensation.kind).toBe('full');
    const undone = applyCompensation(current, compensation.changes);
    expect((undone.nodes.t as unknown as { text: string }).text).toBe('oh my hello world');
  });
});
