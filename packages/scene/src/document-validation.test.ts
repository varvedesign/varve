import { describe, expect, it } from 'vitest';
import {
  type DocumentLike,
  findParentCycle,
  repairDocument,
  validateAndRepairDocument,
  validateDocument,
} from './document-utils';
import type { AdjustmentNode, NodeId, SceneNode } from './types';

function leaf(id: NodeId): SceneNode {
  return { kind: 'shape', id, name: id, visible: true } as unknown as SceneNode;
}

function frame(id: NodeId): SceneNode {
  return {
    kind: 'frame',
    id,
    name: id,
    visible: true,
    children: [],
  } as unknown as SceneNode;
}

function baseDoc(): DocumentLike {
  return {
    rootChildren: ['a', 'b'],
    nodes: { a: leaf('a'), b: leaf('b') },
  };
}

function hasComponentId(n: SceneNode): n is SceneNode & { componentId: NodeId } {
  return 'componentId' in n;
}

describe('validateDocument — reference integrity (section 8/128)', () => {
  it('passes a clean document', () => {
    const result = validateDocument(baseDoc());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('flags an adjustment with a dangling scope target', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('adj') && e.includes('missing'))).toBe(true);
  });

  it('flags an effect mask whose source node is missing', () => {
    const doc = baseDoc();
    const c = {
      kind: 'shape',
      id: 'c',
      name: 'c',
      visible: true,
      effects: [
        {
          id: 'e1',
          type: 'blur',
          mask: { source: { kind: 'scene-node', nodeId: 'ghost' as NodeId }, type: 'alpha' },
        },
      ],
    } as unknown as SceneNode;
    doc.nodes.c = c;
    doc.rootChildren.push('c');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('effect[0]') && e.includes('ghost'))).toBe(true);
  });

  it('flags a component instance whose master node is missing', () => {
    const doc = baseDoc();
    const d = {
      kind: 'group',
      id: 'd',
      name: 'd',
      visible: true,
      children: [] as NodeId[],
      componentId: 'ghost' as NodeId,
    } as unknown as SceneNode;
    doc.nodes.d = d;
    doc.rootChildren.push('d');

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('component instance') && e.includes('ghost'))).toBe(
      true,
    );
  });

  it('flags and repairs a component instance that references a missing variant', () => {
    const doc = baseDoc();
    doc.nodes.master = frame('master');
    doc.rootChildren.push('master');
    doc.components = {
      component: {
        masterRootId: 'master' as NodeId,
        variants: [{ id: 'valid', name: 'Valid', propertyValues: {} }],
      },
    };
    doc.nodes.instance = {
      kind: 'frame',
      id: 'instance' as NodeId,
      name: 'Instance',
      visible: true,
      children: [],
      componentId: 'component' as NodeId,
      variant: 'missing',
    } as unknown as SceneNode;
    doc.rootChildren.push('instance' as NodeId);

    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('missing variant'))).toBe(true);

    const repaired = repairDocument(doc);
    expect(repaired.changed).toBe(true);
    expect((repaired.doc.nodes.instance as { variant?: string }).variant).toBeUndefined();
    expect(validateDocument(repaired.doc).valid).toBe(true);
  });

  it('validates an ordinary frame without looking up component variants', () => {
    const doc = baseDoc();
    doc.nodes.frame = {
      kind: 'frame',
      id: 'frame',
      name: 'Frame',
      visible: true,
      children: [],
    } as unknown as SceneNode;
    doc.rootChildren.push('frame');

    expect(() => validateDocument(doc)).not.toThrow();
    expect(validateDocument(doc).valid).toBe(true);
    expect(repairDocument(doc).changed).toBe(false);
  });

  it('repairs a component variant when the serialized variant entry is malformed', () => {
    const doc = baseDoc();
    doc.nodes.master = frame('master');
    doc.rootChildren.push('master');
    doc.components = {
      component: {
        masterRootId: 'master',
        variants: [null, { id: 'partial' }] as unknown as import('./types').Variant[],
      },
    };
    doc.nodes.instance = {
      kind: 'frame',
      id: 'instance',
      name: 'Instance',
      visible: true,
      children: [],
      componentId: 'component',
      variant: 'variant-1',
    } as unknown as SceneNode;
    doc.rootChildren.push('instance');

    expect(() => validateDocument(doc)).not.toThrow();
    expect(validateDocument(doc).valid).toBe(false);
    const repaired = repairDocument(doc);
    expect(repaired.changed).toBe(true);
    expect(repaired.doc.nodes.instance).not.toHaveProperty('variant');
    expect(repaired.doc.components?.component?.variants).toEqual([]);
  });

  it('flags a component whose master root is missing and removes the dangling instance link', () => {
    const doc = baseDoc();
    doc.components = { component: { masterRootId: 'missing-master' } };
    doc.nodes.instance = {
      kind: 'frame',
      id: 'instance',
      name: 'Instance',
      visible: true,
      children: [],
      componentId: 'component',
    } as unknown as SceneNode;
    doc.rootChildren.push('instance');

    const validation = validateDocument(doc);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some(
        (error) => error.includes('component master') && error.includes('missing-master'),
      ),
    ).toBe(true);
    const repaired = repairDocument(doc);
    expect(repaired.changed).toBe(true);
    expect(repaired.doc.components?.component).toBeUndefined();
    expect(repaired.doc.nodes.instance).not.toHaveProperty('componentId');
  });

  it('validates deeply nested trees without using the call stack', () => {
    const depth = 4000;
    const nodes: Record<NodeId, SceneNode> = {};
    for (let i = depth - 1; i >= 0; i -= 1) {
      const id = `g${i}` as NodeId;
      nodes[id] = {
        kind: 'group',
        id,
        name: id,
        visible: true,
        children: i === depth - 1 ? ['leaf'] : [`g${i + 1}`],
      } as unknown as SceneNode;
    }
    nodes.leaf = leaf('leaf');

    expect(() => validateDocument({ rootChildren: ['g0'], nodes })).not.toThrow();
    expect(validateDocument({ rootChildren: ['g0'], nodes }).valid).toBe(true);
  });

  it('reports a deep containment cycle without overflowing', () => {
    const depth = 2500;
    const nodes: Record<NodeId, SceneNode> = {};
    for (let i = depth - 1; i >= 0; i -= 1) {
      const id = `g${i}` as NodeId;
      nodes[id] = {
        kind: 'group',
        id,
        name: id,
        visible: true,
        children: [i === depth - 1 ? 'g0' : `g${i + 1}`],
      } as unknown as SceneNode;
    }

    const result = validateDocument({ rootChildren: ['g0'], nodes });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('Cycle detected'))).toBe(true);
  });
});

describe('repairDocument — safe neutralization of dangling references', () => {
  it('repairs a dangling explicit-targets adjustment scope and re-validates', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const { doc: repaired, changed } = repairDocument(doc);
    expect(changed).toBe(true);
    expect(validateDocument(repaired).valid).toBe(true);

    const adjNode = repaired.nodes.adj as AdjustmentNode;
    expect(adjNode.scope?.mode).toBe('document');
  });

  it('drops a dangling effect-mask binding but keeps the effect', () => {
    const doc = baseDoc();
    const c = {
      kind: 'shape',
      id: 'c',
      name: 'c',
      visible: true,
      effects: [
        {
          id: 'e1',
          type: 'blur',
          mask: { source: { kind: 'scene-node', nodeId: 'ghost' as NodeId }, type: 'alpha' },
        },
      ],
    } as unknown as SceneNode;
    doc.nodes.c = c;
    doc.rootChildren.push('c');

    const { doc: repaired } = repairDocument(doc);
    const fixed = repaired.nodes.c! as SceneNode & { effects: Array<{ mask?: unknown }> };
    expect(fixed.effects[0]?.mask).toBeUndefined();
  });

  it('clears a dangling component master reference', () => {
    const doc = baseDoc();
    const d = {
      kind: 'group',
      id: 'd',
      name: 'd',
      visible: true,
      children: [] as NodeId[],
      componentId: 'ghost' as NodeId,
    } as unknown as SceneNode;
    doc.nodes.d = d;
    doc.rootChildren.push('d');

    const { doc: repaired } = repairDocument(doc);
    expect(hasComponentId(repaired.nodes.d!)).toBe(false);
  });

  it('repairs a dangling live matte source', () => {
    const doc = baseDoc();
    doc.nodes.a = {
      ...doc.nodes.a,
      mask: {
        type: 'alpha',
        visible: true,
        matteSource: { kind: 'scene-node', nodeId: 'ghost' as NodeId },
      },
    } as unknown as SceneNode;

    const { doc: repaired, changed } = repairDocument(doc);
    expect(changed).toBe(true);
    expect(repaired.nodes.a?.mask).toBeUndefined();
    expect(validateDocument(repaired).valid).toBe(true);
  });

  it('uses component definitions rather than treating component ids as node ids', () => {
    const doc = baseDoc();
    doc.nodes.master = frame('master');
    doc.rootChildren.push('master');
    doc.components = { button: { masterRootId: 'master' } };
    doc.nodes.b = {
      ...doc.nodes.b,
      kind: 'frame',
      children: [],
      componentId: 'button',
    } as unknown as SceneNode;

    expect(validateDocument(doc).valid).toBe(true);
  });

  it('does not mutate the input document', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'explicit-targets', targetNodeIds: ['missing'] as NodeId[] },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const snapshot = JSON.stringify(doc);
    repairDocument(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('validateAndRepairDocument returns a doc that re-validates clean', () => {
    const doc = baseDoc();
    const adj = {
      kind: 'adjustment',
      id: 'adj',
      name: 'adj',
      visible: true,
      scope: { mode: 'image-local', targetNodeId: 'missing' as NodeId },
    } as unknown as SceneNode;
    doc.nodes.adj = adj;
    doc.rootChildren.push('adj');

    const { result, repaired } = validateAndRepairDocument(doc);
    expect(result.valid).toBe(false);
    expect(repaired.changed).toBe(true);
    expect(validateDocument(repaired.doc).valid).toBe(true);
  });

  it('coerces malformed text fields to empty strings', () => {
    const doc = baseDoc();
    const textNode = {
      kind: 'text',
      id: 'text1',
      name: 'Malformed text',
      visible: true,
      text: { ops: [{ insert: 'Hello' }] }, // Wrong type - should be string
    } as unknown as SceneNode;
    doc.nodes.text1 = textNode;
    doc.rootChildren.push('text1');

    const { doc: repaired, changed } = repairDocument(doc);
    expect(changed).toBe(true);
    const fixed = repaired.nodes.text1 as { kind: string; text: unknown };
    expect(fixed.kind).toBe('text');
    expect(fixed.text).toBe('');
    expect(typeof fixed.text).toBe('string');
  });
});

describe('unknown future container traversal', () => {
  function unknownContainer(children: NodeId[]): SceneNode {
    return {
      kind: 'futureContainer',
      id: 'future',
      name: 'Future',
      visible: true,
      children,
    } as unknown as SceneNode;
  }

  it('keeps children of an unknown container reachable', () => {
    const doc: DocumentLike = {
      rootChildren: ['future'],
      nodes: { future: unknownContainer(['leaf']), leaf: leaf('leaf') },
    };

    const result = validateDocument(doc);
    // Before the traversal fix the child was reported as an orphan even
    // though the serialized container owns it.
    expect(result.errors).toEqual([]);
  });

  it('detects a parent cycle through an unknown container', () => {
    const doc: DocumentLike = {
      rootChildren: ['future'],
      nodes: { future: unknownContainer(['future']) },
    };

    expect(findParentCycle(doc)).not.toBeNull();
  });
});
