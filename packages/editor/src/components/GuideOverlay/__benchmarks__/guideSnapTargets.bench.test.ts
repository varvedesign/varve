/**
 * Guide snap-target build cost.
 *
 * `getGuideSnapTargets` runs once per guide gesture (never per pointer sample
 * and never during render), so the budget is per gesture: it must stay far
 * below a frame so a drag does not hitch on a large page.
 */
import { addNode, createDocument, type Document, makeShapeNode } from '@varve/scene';
import { describe, expect, test } from 'vitest';
import { getGuideSnapTargets } from '../guideSnapTargets';

function buildDocument(nodeCount: number): Document {
  let doc = createDocument('snap-targets-bench', true);
  for (let i = 0; i < nodeCount; i++) {
    doc = addNode(
      doc,
      makeShapeNode(
        `n-${i}`,
        { kind: 'rect', x: (i % 50) * 40, y: Math.floor(i / 50) * 40, w: 32, h: 32 },
        { name: `n-${i}` },
      ),
    );
  }
  return doc;
}

function medianBuildMs(doc: Document): number {
  const build = (): number => {
    const start = performance.now();
    getGuideSnapTargets(doc);
    return performance.now() - start;
  };
  // Discard cold JIT work, then use the median so one preempted worker cannot
  // turn into a reported regression.
  build();
  const samples = Array.from({ length: 5 }, build).sort((left, right) => left - right);
  return samples[2] ?? Number.POSITIVE_INFINITY;
}

describe('guide snap targets bench', () => {
  test('builds targets for 1k objects within one 60fps frame', () => {
    const doc = buildDocument(1000);
    expect(medianBuildMs(doc)).toBeLessThan(16);
  });

  test('builds targets for 5k objects without a drag-visible hitch', () => {
    const doc = buildDocument(5000);
    expect(medianBuildMs(doc)).toBeLessThan(80);
  });
});
