import type { SceneNode as EngineSceneNode } from '@varve/engine';
import { type Affine, multiplyAffine, rotateRad, translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { sampleBuildOverrides, sampleBuildStepOverride } from './buildEffects';
import {
  collectMorphViews,
  matchMorphNodes,
  sampleMorphPairOverride,
  unmatchedMorphOpacity,
} from './morphMatch';
import type { BuildStepSample } from './showTiming';

function engineNode(overrides: Partial<EngineSceneNode> & { id: string }): EngineSceneNode {
  return {
    name: overrides.id,
    transform: [1, 0, 0, 1, 0, 0],
    kind: 'rect',
    w: 100,
    h: 50,
    ...overrides,
  } as EngineSceneNode;
}

function sampleOf(
  state: BuildStepSample['state'],
  progress = 0,
  step: Partial<BuildStepSample['timing']['step']> = {},
): BuildStepSample {
  return {
    timing: {
      step: { id: 's', nodeId: 'node-1', effect: 'fade', trigger: 'onClick', ...step },
      groupId: 0,
      offsetMs: 0,
      durationMs: 400,
    },
    state,
    progress,
  };
}

describe('morph matching contract', () => {
  it('matches unique same-kind names and interpolates text boxes with equal names', () => {
    const from = [
      {
        id: 'a1',
        name: 'Headline',
        kindClass: 'text' as const,
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
      {
        id: 'a2',
        name: 'Body',
        kindClass: 'text' as const,
        transformLocal: [1, 0, 0, 1, 0, 30] as Affine,
      },
    ];
    const to = [
      {
        id: 'b1',
        name: 'Headline',
        kindClass: 'text' as const,
        transformLocal: [1, 0, 0, 1, 200, 0] as Affine,
      },
      {
        id: 'b2',
        name: 'Chart',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
    ];
    const match = matchMorphNodes(from, to);
    expect(match.pairs).toEqual([{ fromId: 'a1', toId: 'b1', name: 'Headline' }]);
    expect(match.unmatchedFromIds).toEqual(['a2']);
    expect(match.unmatchedToIds).toEqual(['b2']);
  });

  it('never matches on identical text or shape alone, only on names', () => {
    const from = [
      {
        id: 'a1',
        name: 'Rect 3',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
    ];
    const to = [
      {
        id: 'b1',
        name: 'Totally different',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
    ];
    expect(matchMorphNodes(from, to).pairs).toEqual([]);
  });

  it('refuses cross-kind and cross-shape-kind matches', () => {
    const from = [
      {
        id: 'a1',
        name: 'Thing',
        kindClass: 'text' as const,
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
      {
        id: 'a2',
        name: 'Box',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
    ];
    const to = [
      {
        id: 'b1',
        name: 'Thing',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
      {
        id: 'b2',
        name: 'Box',
        kindClass: 'shape' as const,
        shapeKind: 'ellipse',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
    ];
    expect(matchMorphNodes(from, to).pairs).toEqual([]);
  });

  it('treats ambiguous duplicate names on one side as unmatched instead of guessing', () => {
    const from = [
      {
        id: 'a1',
        name: 'Card',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 0] as Affine,
      },
      {
        id: 'a2',
        name: 'Card',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 0, 100] as Affine,
      },
    ];
    const to = [
      {
        id: 'b1',
        name: 'Card',
        kindClass: 'shape' as const,
        shapeKind: 'rect',
        transformLocal: [1, 0, 0, 1, 50, 0] as Affine,
      },
    ];
    const match = matchMorphNodes(from, to);
    expect(match.pairs).toEqual([]);
    expect(match.unmatchedFromIds).toEqual(['a1', 'a2']);
    expect(match.unmatchedToIds).toEqual(['b1']);
  });

  it('collects views in frame-local space and skips the frame and groups', () => {
    const frameWorld = translate(5000, 2000);
    const nodes = [
      engineNode({ id: 'frame', kind: 'frame', transform: frameWorld }),
      engineNode({ id: 'child', transform: multiplyAffine(frameWorld, [1, 0, 0, 1, 40, 60]) }),
      engineNode({ id: 'group', kind: 'group', transform: frameWorld }),
    ];
    const views = collectMorphViews(nodes, 'frame');
    expect(views).toHaveLength(1);
    expect(views[0]!.transformLocal).toEqual([1, 0, 0, 1, 40, 60]);
  });
});

describe('morph interpolation', () => {
  const identity: Affine = [1, 0, 0, 1, 0, 0];

  it('takes the shortest rotation arc instead of spinning the long way', () => {
    const fromNode = engineNode({ id: 'f', transform: rotateRad(0) });
    const toNode = engineNode({ id: 't', transform: rotateRad((Math.PI * 3) / 2) });
    const geometry = { frameWorldFrom: identity, frameWorldTo: identity };
    const mid = sampleMorphPairOverride(fromNode, toNode, geometry, 0.5);
    const a = mid.transform!;
    // Halfway between 0 and 3π/2 shortest-arc is -π/4: cos ≈ √2/2, sin ≈ -√2/2.
    expect(a[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(a[1]).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('maps interpolated geometry back through the incoming frame world', () => {
    const frameFrom = translate(0, 0);
    const frameTo = translate(1920, 0);
    const fromNode = engineNode({ id: 'f', transform: translate(100, 50) });
    const toNode = engineNode({
      id: 't',
      transform: multiplyAffine(frameTo, translate(300, 90)),
    });
    const geometry = { frameWorldFrom: frameFrom, frameWorldTo: frameTo };
    // Overrides replace the to-node's world transform, so the settled value
    // equals the node's own world position.
    const end = sampleMorphPairOverride(fromNode, toNode, geometry, 1);
    expect(end.transform).toEqual([1, 0, 0, 1, 2220, 90]);
    const start = sampleMorphPairOverride(fromNode, toNode, geometry, 0);
    expect(start.transform).toEqual([1, 0, 0, 1, 2020, 50]);
  });

  it('fades unmatched objects in place', () => {
    expect(unmatchedMorphOpacity('to', 0.25)).toBeCloseTo(0.25, 5);
    expect(unmatchedMorphOpacity('from', 0.25)).toBeCloseTo(0.75, 5);
    expect(unmatchedMorphOpacity('from', 1)).toBe(0);
    expect(unmatchedMorphOpacity('to', 1)).toBe(1);
  });
});

describe('build effects', () => {
  const context = { frameWidth: 1920, frameHeight: 1080 };

  it('hides entrance objects while pending and restores them when done', () => {
    const node = engineNode({ id: 'node-1' });
    expect(sampleBuildStepOverride(step0('fade'), sampleOf('pending'), node, context)).toEqual({
      opacity: 0,
    });
    expect(sampleBuildStepOverride(step0('fade'), sampleOf('done'), node, context)).toEqual({});
  });

  it('animates fade and fly-in from sampled progress', () => {
    const node = engineNode({ id: 'node-1' });
    expect(sampleBuildStepOverride(step0('fade'), sampleOf('active', 0.5), node, context)).toEqual({
      opacity: 0.5,
    });
    const fly = sampleBuildStepOverride(
      step0('flyIn', { direction: 'left' }),
      sampleOf('active', 0),
      node,
      context,
    );
    // Start: fully off-screen to the left, quickly fading in.
    expect(fly.transform![4]).toBeCloseTo(-1920, 5);
    expect(fly.opacity).toBe(0);
    const landed = sampleBuildStepOverride(
      step0('flyIn', { direction: 'left' }),
      sampleOf('done'),
      node,
      context,
    );
    expect(landed.transform).toBeUndefined();
  });

  it('keeps exit objects visible until their step starts and hidden after', () => {
    const node = engineNode({ id: 'node-1' });
    expect(sampleBuildStepOverride(step0('flyOut'), sampleOf('pending'), node, context)).toEqual(
      {},
    );
    expect(sampleBuildStepOverride(step0('flyOut'), sampleOf('done'), node, context)).toEqual({
      opacity: 0,
    });
  });

  it('returns pulse to identity when done', () => {
    const node = engineNode({ id: 'node-1' });
    expect(sampleBuildStepOverride(step0('pulse'), sampleOf('done'), node, context)).toEqual({});
    const mid = sampleBuildStepOverride(step0('pulse'), sampleOf('active', 0.5), node, context);
    expect(mid.transform).toBeDefined();
  });

  it('hides pending by-paragraph ranges through the aggregate sampler', () => {
    const node = engineNode({
      id: 'node-1',
      kind: 'text',
      text: 'First\nSecond\nThird',
    });
    const nodesById = new Map([['node-1', node]]);
    const result = sampleBuildOverrides(
      [
        sampleOf('done', 1, { id: 's1', paragraphRange: { from: 0, to: 0 } }),
        sampleOf('pending', 0, { id: 's2', paragraphRange: { from: 1, to: 2 } }),
      ].map((s, index) => ({
        ...s,
        timing: { ...s.timing, step: { ...s.timing.step, id: `s${index + 1}` } },
      })),
      nodesById,
      context,
    );
    expect(result.hiddenParagraphs.get('node-1')).toEqual([{ from: 1, to: 2 }]);
  });
});

function step0(effect: string, extra: Record<string, unknown> = {}) {
  return {
    id: 's',
    nodeId: 'node-1',
    effect: effect as 'fade',
    trigger: 'onClick' as const,
    ...extra,
  };
}
