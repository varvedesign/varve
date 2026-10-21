import {
  buildParentIndexMap,
  createDocument,
  createVariableStore,
  makeFrameNode,
  makeShapeNode,
  type Document,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createTransformCache } from '../../scene/transformCache';
import { EngineNodeMemo } from '../engineNodeMemo';
import { expandReplayList } from '../dirtyReplay';

describe('expandReplayList', () => {
  it('builds IR for appended ancestor dependencies, not just accepted candidates', () => {
    const frame = makeFrameNode('frame', { w: 100, h: 100, children: ['leaf'] });
    const leaf = makeShapeNode('leaf', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const base = createDocument('dirty-replay', true);
    const doc: Document = {
      ...base,
      nodes: { frame, leaf },
      rootChildren: ['frame'],
    };

    const result = expandReplayList({
      doc,
      appendIds: ['leaf'],
      parentIndex: buildParentIndexMap(doc),
      cache: createTransformCache(),
      variantCaches: new Map(),
      variableStore: createVariableStore(),
      resolvedStyles: new Map(),
      engineMemo: new EngineNodeMemo(),
      canMemoEngineNodes: false,
      showOriginalBgNodeId: '',
    });

    expect(result.replaySet?.has('frame')).toBe(true);
    expect(result.nodeIds).toContain('frame');
    expect(result.flatNodes.some((node) => node.id === 'frame')).toBe(true);
  });
});
