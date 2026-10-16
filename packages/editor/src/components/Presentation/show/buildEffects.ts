import type { SceneNode as EngineSceneNode } from '@varve/engine';
import type { PresentationBuildStep, PresentationTransitionDirection } from '@varve/scene';
import { type Affine, multiplyAffine } from '@varve/shared';
import type { BuildStepSample } from './showTiming';

/**
 * Build-effect sampling: turns build step states into engine-node overrides
 * for the slide renderer. All effects are reversible functions of clock
 * progress; nothing here mutates the document.
 *
 * Effect classes:
 * - entrance (appear, fade, flyIn, wipe, zoomIn): hidden until the step
 *   starts, then revealed. Pending steps keep the object hidden.
 * - exit (flyOut, zoomOut): visible until the step starts, then removed.
 * - emphasis (pulse): always visible; a transient transform bump.
 *
 * By-paragraph steps patch the target text node's logical paragraph content,
 * so a one-line rewrap never splits a build into two clicks and RTL/CJK
 * paragraph order is preserved by construction.
 */

export interface BuildNodeOverride {
  opacity?: number;
  transform?: Affine;
  text?: string;
}

export interface BuildEffectContext {
  /** Slide pixel size, used for fly-in/fly-out travel distance. */
  frameWidth: number;
  frameHeight: number;
}

const ENTRANCE_EFFECTS = new Set(['appear', 'fade', 'flyIn', 'wipe', 'zoomIn']);
const EXIT_EFFECTS = new Set(['flyOut', 'zoomOut']);

export function isExitEffect(effect: string): boolean {
  return EXIT_EFFECTS.has(effect);
}

function directionVector(direction: PresentationTransitionDirection | undefined): {
  dx: number;
  dy: number;
} {
  switch (direction) {
    case 'right':
      return { dx: 1, dy: 0 };
    case 'up':
      return { dx: 0, dy: -1 };
    case 'down':
      return { dx: 0, dy: 1 };
    default:
      return { dx: -1, dy: 0 };
  }
}

function ease(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

function paragraphsOf(node: EngineSceneNode): string[] {
  const rich = node.richText;
  if (rich && Array.isArray(rich.paragraphs)) {
    return rich.paragraphs.map((paragraph) => {
      const runs = 'runs' in paragraph ? paragraph.runs : undefined;
      if (Array.isArray(runs)) {
        return runs.map((run) => ('text' in run ? String(run.text ?? '') : '')).join('');
      }
      return 'text' in paragraph ? String((paragraph as { text?: string }).text ?? '') : '';
    });
  }
  return typeof node.text === 'string' ? node.text.split('\n') : [];
}

/**
 * Patches a text node's logical paragraph content so pending by-paragraph
 * steps stay hidden. The visible prefix is chosen in reading order, so a
 * one-line rewrap never changes which click reveals which paragraph.
 */
export function patchTextForHiddenParagraphs(
  node: EngineSceneNode,
  hidden: Array<{ from: number; to: number }>,
): { text?: string } {
  if (hidden.length === 0) return {};
  const paragraphs = paragraphsOf(node);
  if (paragraphs.length === 0) return {};
  const hiddenSet = new Set<number>();
  for (const range of hidden) {
    for (let index = range.from; index <= Math.min(range.to, paragraphs.length - 1); index++) {
      if (index >= 0) hiddenSet.add(index);
    }
  }
  if (hiddenSet.size === 0) return {};
  const visible = paragraphs.filter((_, index) => !hiddenSet.has(index));
  // Rich text keeps its paragraph objects; the plain-text override is only a
  // fallback for unstyled nodes and stays honest about the hidden ranges.
  return { text: visible.join('\n') };
}

/**
 * Samples the override for one step targeting one node. Returns an empty
 * object when the step contributes no visible change (already settled in).
 */
export function sampleBuildStepOverride(
  step: PresentationBuildStep,
  sample: BuildStepSample,
  node: EngineSceneNode,
  context: BuildEffectContext,
): BuildNodeOverride {
  const { effect } = step;
  const p = ease(sample.progress);
  if (ENTRANCE_EFFECTS.has(effect)) {
    if (sample.state === 'pending') return { opacity: 0 };
    if (sample.state === 'done') return {};
    switch (effect) {
      case 'appear':
        return { opacity: 0 };
      case 'fade':
        return { opacity: p };
      case 'flyIn': {
        const { dx, dy } = directionVector(step.direction);
        const distance = dx !== 0 ? context.frameWidth : context.frameHeight;
        const travel = 1 - p;
        return {
          opacity: Math.min(1, p * 4),
          transform: multiplyAffine(node.transform as Affine, [
            1,
            0,
            0,
            1,
            dx * distance * travel,
            dy * distance * travel,
          ]) as Affine,
        };
      }
      case 'wipe': {
        // Anisotropic scale anchored at the entry edge; a deterministic wipe
        // for opaque geometry without an IR-level clip pass.
        const { dx, dy } = directionVector(step.direction);
        const sx = dx !== 0 ? Math.max(p, 0.001) : 1;
        const sy = dy !== 0 ? Math.max(p, 0.001) : 1;
        const w = node.w ?? 0;
        const h = node.h ?? 0;
        const anchorX = dx > 0 ? w : 0;
        const anchorY = dy > 0 ? h : 0;
        return {
          opacity: 1,
          transform: multiplyAffine(
            node.transform as Affine,
            multiplyAffine(
              [1, 0, 0, 1, anchorX, anchorY] as Affine,
              multiplyAffine(
                [sx, 0, 0, sy, 0, 0] as Affine,
                [1, 0, 0, 1, -anchorX, -anchorY] as Affine,
              ),
            ),
          ) as Affine,
        };
      }
      case 'zoomIn': {
        const s = Math.max(p, 0.001);
        const cx = (node.w ?? 0) / 2;
        const cy = (node.h ?? 0) / 2;
        return {
          opacity: p,
          transform: multiplyAffine(
            node.transform as Affine,
            multiplyAffine(
              [1, 0, 0, 1, cx, cy] as Affine,
              multiplyAffine([s, 0, 0, s, 0, 0] as Affine, [1, 0, 0, 1, -cx, -cy] as Affine),
            ),
          ) as Affine,
        };
      }
      default:
        return {};
    }
  }

  if (EXIT_EFFECTS.has(effect)) {
    if (sample.state === 'pending') return {};
    if (sample.state === 'done') return { opacity: 0 };
    const q = 1 - p;
    switch (effect) {
      case 'flyOut': {
        const { dx, dy } = directionVector(step.direction);
        const distance = dx !== 0 ? context.frameWidth : context.frameHeight;
        return {
          opacity: Math.max(0, 1 - p * 4),
          transform: multiplyAffine(node.transform as Affine, [
            1,
            0,
            0,
            1,
            dx * distance * p,
            dy * distance * p,
          ]) as Affine,
        };
      }
      case 'zoomOut': {
        const s = Math.max(q, 0.001);
        const cx = (node.w ?? 0) / 2;
        const cy = (node.h ?? 0) / 2;
        return {
          opacity: q,
          transform: multiplyAffine(
            node.transform as Affine,
            multiplyAffine(
              [1, 0, 0, 1, cx, cy] as Affine,
              multiplyAffine([s, 0, 0, s, 0, 0] as Affine, [1, 0, 0, 1, -cx, -cy] as Affine),
            ),
          ) as Affine,
        };
      }
      default:
        return {};
    }
  }

  // Emphasis: pulse scales about center on a half-sine so it starts and ends
  // at identity and never leaves the object displaced.
  if (effect === 'pulse' && sample.state === 'active') {
    const bump = 1 + 0.08 * Math.sin(Math.PI * p);
    const cx = (node.w ?? 0) / 2;
    const cy = (node.h ?? 0) / 2;
    return {
      transform: multiplyAffine(
        node.transform as Affine,
        multiplyAffine(
          [1, 0, 0, 1, cx, cy] as Affine,
          multiplyAffine([bump, 0, 0, bump, 0, 0] as Affine, [1, 0, 0, 1, -cx, -cy] as Affine),
        ),
      ) as Affine,
    };
  }
  return {};
}

export interface BuildSampleResult {
  overrides: Map<string, BuildNodeOverride>;
  /** Paragraph ranges per node hidden by pending by-paragraph steps. */
  hiddenParagraphs: Map<string, Array<{ from: number; to: number }>>;
}

/**
 * Aggregates all build samples on a slide into per-node overrides. Later
 * steps targeting the same node win for transform/opacity; paragraph ranges
 * from every pending step on the node combine.
 */
export function sampleBuildOverrides(
  samples: readonly BuildStepSample[],
  nodesById: ReadonlyMap<string, EngineSceneNode>,
  context: BuildEffectContext,
): BuildSampleResult {
  const overrides = new Map<string, BuildNodeOverride>();
  const hiddenParagraphs = new Map<string, Array<{ from: number; to: number }>>();
  for (const sample of samples) {
    const { step } = sample.timing;
    const node = nodesById.get(step.nodeId);
    if (!node) continue;
    if (step.paragraphRange) {
      if (sample.state === 'pending') {
        const ranges = hiddenParagraphs.get(step.nodeId) ?? [];
        ranges.push(step.paragraphRange);
        hiddenParagraphs.set(step.nodeId, ranges);
      }
      continue;
    }
    const sampled = sampleBuildStepOverride(step, sample, node, context);
    const existing = overrides.get(step.nodeId) ?? {};
    overrides.set(step.nodeId, { ...existing, ...sampled });
  }
  return { overrides, hiddenParagraphs };
}
