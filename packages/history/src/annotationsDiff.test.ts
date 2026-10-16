/**
 * Annotations reach revision history as per-entity changes.
 *
 * This lives in `@varve/history` rather than beside the model because history
 * depends on scene; the reverse import would be a workspace cycle. The claim
 * under test is the one `TOP_LEVEL_COLLECTIONS` buys: without a registry entry,
 * a top-level field degrades to a single document-level replacement, so one
 * annotation edit would look like the whole annotations field changed.
 */

import type { Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from './diff';

const FRAME = 'frame-1';
const NOW = 1_700_000_000_000;

function doc(annotations: Record<string, unknown>): Document {
  return {
    id: 'doc-1',
    formatVersion: '2.34',
    name: 'Test',
    nextId: 10,
    rootChildren: [FRAME],
    nodes: {
      [FRAME]: {
        kind: 'frame',
        id: FRAME,
        name: 'Home',
        transform: [1, 0, 0, 1, 0, 0],
        w: 100,
        h: 100,
        children: [],
      },
    },
    pages: [],
    guides: [],
    annotations,
  } as unknown as Document;
}

describe('annotation diff granularity', () => {
  it('reports an added annotation as an annotation-entity change', () => {
    const before = doc({});
    const after = doc({
      an1: {
        id: 'an1',
        anchorNodeId: FRAME,
        kind: 'note',
        text: 'needs a loading state',
        createdAt: NOW,
      },
    });
    const diff = diffDocuments(before, after);
    const annotationChanges = diff.changes.filter((change) => change.entityType === 'annotation');
    expect(annotationChanges.length).toBeGreaterThan(0);
    expect(annotationChanges.some((change) => change.entityId === 'an1')).toBe(true);
  });

  it('does not degrade a single annotation edit to a document replacement', () => {
    const before = doc({
      an1: { id: 'an1', anchorNodeId: FRAME, kind: 'note', text: 'one', createdAt: NOW },
      an2: { id: 'an2', anchorNodeId: FRAME, kind: 'note', text: 'two', createdAt: NOW },
    });
    const after = doc({
      an1: { id: 'an1', anchorNodeId: FRAME, kind: 'note', text: 'one edited', createdAt: NOW },
      an2: { id: 'an2', anchorNodeId: FRAME, kind: 'note', text: 'two', createdAt: NOW },
    });
    const diff = diffDocuments(before, after);
    const documentReplacements = diff.changes.filter(
      (change) => change.entityType === 'document' && change.propertyPath === 'annotations',
    );
    expect(documentReplacements).toHaveLength(0);
    // The untouched annotation must not appear as changed.
    const touched = diff.changes
      .filter((change) => change.entityType === 'annotation')
      .map((change) => change.entityId);
    expect(touched).toContain('an1');
    expect(touched).not.toContain('an2');
  });
});
