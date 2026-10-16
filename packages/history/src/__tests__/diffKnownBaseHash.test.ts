import type { Document } from '@varve/scene';
import {
  addNode,
  applyOperation,
  canonicalHistoryHash,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../diff';

registerBuiltinOperations();

function pair(): { base: Document; target: Document } {
  const doc = { ...createDocument('known-hash', { flat: true }), id: 'known-hash' } as Document;
  const base = addNode(doc, makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
  const target = applyOperation(base, 'node.patch', {
    nodeId: 'n1_aaaa',
    path: 'opacity',
    value: 0.4,
  });
  return { base, target };
}

describe('diffDocuments baseHash option', () => {
  it('produces the same diff when handed the base document its true hash', () => {
    const { base, target } = pair();
    const plain = diffDocuments(base, target, { epsilonPolicy: 'exact' });
    const hinted = diffDocuments(base, target, {
      epsilonPolicy: 'exact',
      baseHash: canonicalHistoryHash(base),
    });
    expect(hinted).toEqual(plain);
    expect(hinted.changed).toBe(true);
  });

  it('trusts the supplied digest instead of recomputing it', () => {
    const { base, target } = pair();
    const stated = 'f'.repeat(64);
    const result = diffDocuments(base, target, { epsilonPolicy: 'exact', baseHash: stated });
    expect(result.baseHash).toBe(stated);
    expect(result.targetHash).toBe(canonicalHistoryHash(target));
  });

  it('still computes the target digest and reports unchanged for equal documents', () => {
    const { base } = pair();
    const result = diffDocuments(base, base, {
      epsilonPolicy: 'exact',
      baseHash: canonicalHistoryHash(base),
    });
    expect(result.changed).toBe(false);
    expect(result.targetHash).toBe(result.baseHash);
  });
});
