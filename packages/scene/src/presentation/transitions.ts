import type { EasingDefinition } from '@varve/shared';
import {
  MAX_PRESENTATION_BUILDS_PER_SLIDE,
  PRESENTATION_BUILD_DELAY_LIMIT_MS,
  PRESENTATION_BUILD_DURATION_LIMIT_MS,
  PRESENTATION_BUILD_EFFECTS,
  PRESENTATION_BUILD_TRIGGERS,
  PRESENTATION_TRANSITION_DIRECTIONS,
  PRESENTATION_TRANSITION_DURATION_LIMIT_MS,
  PRESENTATION_TRANSITION_KINDS,
  type PresentationBuildStep,
  type PresentationDeck,
  type PresentationSlideEntry,
  type PresentationTransition,
  type PresentationTransitionDirection,
} from './types';

/**
 * Load-path validation and normalization for authored transitions and builds.
 * The type and kind definitions live in ./types.ts next to the rest of the
 * presentation schema so this module stays one-directional over it.
 *
 * Fractional durations are preserved exactly; nothing here rounds to whole
 * seconds or substitutes an effect default for an authored value.
 */

const TRANSITION_KIND_SET = new Set<string>(PRESENTATION_TRANSITION_KINDS);
const TRANSITION_DIRECTION_SET = new Set<string>(PRESENTATION_TRANSITION_DIRECTIONS);
const BUILD_EFFECT_SET = new Set<string>(PRESENTATION_BUILD_EFFECTS);
const BUILD_TRIGGER_SET = new Set<string>(PRESENTATION_BUILD_TRIGGERS);

const EASING_KINDS = new Set([
  'linear',
  'ease',
  'easeIn',
  'easeOut',
  'easeInOut',
  'cubicBezier',
  'spring',
  'steps',
]);

function boundedDuration(value: unknown, limit: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit
    ? value
    : undefined;
}

export function isValidPresentationEasing(value: unknown): value is EasingDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !EASING_KINDS.has(record.kind)) return false;
  if (record.kind === 'cubicBezier' || record.kind === 'spring' || record.kind === 'steps') {
    return true;
  }
  // Plain named easings carry no extra fields.
  return Object.keys(record).length === 1;
}

export function isValidPresentationDirection(
  value: unknown,
): value is PresentationTransitionDirection {
  return typeof value === 'string' && TRANSITION_DIRECTION_SET.has(value);
}

export function isValidPresentationTransition(value: unknown): value is PresentationTransition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !TRANSITION_KIND_SET.has(record.kind)) return false;
  if (boundedDuration(record.durationMs, PRESENTATION_TRANSITION_DURATION_LIMIT_MS) === undefined) {
    return false;
  }
  if (record.easing !== undefined && !isValidPresentationEasing(record.easing)) return false;
  if (record.direction !== undefined && !isValidPresentationDirection(record.direction)) {
    return false;
  }
  return true;
}

export function isValidPresentationBuild(value: unknown): value is PresentationBuildStep {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return false;
  if (typeof record.nodeId !== 'string' || !record.nodeId) return false;
  if (typeof record.effect !== 'string' || !BUILD_EFFECT_SET.has(record.effect)) return false;
  if (typeof record.trigger !== 'string' || !BUILD_TRIGGER_SET.has(record.trigger)) return false;
  if (
    record.delayMs !== undefined &&
    boundedDuration(record.delayMs, PRESENTATION_BUILD_DELAY_LIMIT_MS) === undefined
  ) {
    return false;
  }
  if (
    record.durationMs !== undefined &&
    boundedDuration(record.durationMs, PRESENTATION_BUILD_DURATION_LIMIT_MS) === undefined
  ) {
    return false;
  }
  if (record.direction !== undefined && !isValidPresentationDirection(record.direction)) {
    return false;
  }
  if (record.easing !== undefined && !isValidPresentationEasing(record.easing)) return false;
  if (record.paragraphRange !== undefined) {
    if (typeof record.paragraphRange !== 'object' || record.paragraphRange === null) return false;
    const range = record.paragraphRange as Record<string, unknown>;
    const from = range.from;
    const to = range.to;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      (from as number) < 0 ||
      (to as number) < (from as number)
    ) {
      return false;
    }
  }
  return true;
}

/** Defensive load-path normalization; invalid steps are dropped, valid ones keep fractional values. */
export function normalizePresentationBuilds(value: unknown): PresentationBuildStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const builds = value.filter(isValidPresentationBuild).slice(0, MAX_PRESENTATION_BUILDS_PER_SLIDE);
  return builds.length > 0 ? builds : undefined;
}

/**
 * Transition precedence for one slide: the entry override wins, then the deck
 * default, then an explicit cut. Directional kinds get a default direction so
 * playback never has to invent one.
 */
export function resolveSlideTransition(
  deck: PresentationDeck,
  entry: PresentationSlideEntry,
): PresentationTransition {
  const source = entry.transition ?? deck.defaultTransition;
  if (!source) return { kind: 'none', durationMs: 0 };
  const needsDirection =
    source.kind === 'slide' || source.kind === 'push' || source.kind === 'wipe';
  const direction = source.direction ?? (needsDirection ? 'left' : undefined);
  return {
    kind: source.kind,
    durationMs: source.durationMs,
    ...(source.easing ? { easing: source.easing } : {}),
    ...(direction ? { direction } : {}),
  };
}
