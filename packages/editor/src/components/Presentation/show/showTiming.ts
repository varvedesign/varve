import type { PresentationBuildStep, PresentationTransition } from '@varve/scene';
import { PRESENTATION_DEFAULT_TRANSITION_MS } from '@varve/scene';

/**
 * Deterministic show timing.
 *
 * All playback times derive from one monotonic show clock (elapsed ms since
 * the show started, pausable). Nothing here accumulates per-frame deltas, and
 * nothing rounds durations: a 333.5ms transition lasts exactly 333.5ms on
 * every code path (import, preview, delivery, re-export).
 *
 * Build sequencing model: document-ordered build steps are split into click
 * groups at every `onClick` step. Click k shows group k. `withPrevious`
 * starts with the previous step in the group; `afterPrevious` starts when the
 * previous step ends. If the FIRST authored step is not `onClick`, its group
 * is the auto group and starts exactly once when the slide's transition
 * completes — never re-triggered by seeks, rapid clicks, or rebuilds.
 */

export const PRESENTATION_DEFAULT_BUILD_MS = 400;

export interface BuildStepTiming {
  step: PresentationBuildStep;
  /** Zero-based click group this step belongs to. */
  groupId: number;
  /** Offset from the group's zero time, in ms (delay and chain waits applied). */
  offsetMs: number;
  /** Effective duration in ms; 0 completes immediately. */
  durationMs: number;
}

export interface BuildSchedule {
  groups: BuildStepTiming[][];
  /** True when the first group starts automatically at build zero. */
  autoFirstGroup: boolean;
}

export type BuildStepState = 'pending' | 'active' | 'done';

export interface BuildStepSample {
  timing: BuildStepTiming;
  state: BuildStepState;
  /** Eased 0..1 progress; 1 whenever state is 'done'. */
  progress: number;
}

export interface ShowSample {
  /** Index into the included (non-skipped) slide list. */
  slideIndex: number;
  /** Show-clock time when delivery entered the current slide (this visit). */
  slideEnteredAt: number;
  /** The slide is arriving; transition progress is meaningful. */
  phase: 'transition' | 'shown';
  transition: {
    kind: PresentationTransition['kind'];
    durationMs: number;
    direction: PresentationTransition['direction'];
    /** Linear clock progress 0..1; easing is applied by the renderer. */
    progress: number;
  } | null;
  builds: BuildStepSample[];
  /** Number of click groups whose zero time has been reached. */
  startedGroups: number;
}

export interface ScheduleInput {
  transition: PresentationTransition;
  schedule: BuildSchedule;
}

export type AdvanceResult =
  | 'completed-transition'
  | 'completed-effect'
  | 'started-build-group'
  | 'advanced-slide'
  | 'boundary';

interface SlideRuntime {
  transition: PresentationTransition;
  schedule: BuildSchedule;
  enteredAt: number;
  /** Transition end time once finalized; null while the transition runs. */
  shownAt: number | null;
  /** Group zero times (show-clock ms); index -1 entries are not yet started. */
  groupZeros: number[];
  allBuilt: boolean;
}

const NOT_STARTED = -1;

export function computeBuildSchedule(steps: readonly PresentationBuildStep[]): BuildSchedule {
  const groups: BuildStepTiming[][] = [];
  let current: BuildStepTiming[] | null = null;
  for (const step of steps) {
    if (step.trigger === 'onClick' || current === null) {
      current = [];
      groups.push(current);
    }
    current.push({
      step,
      groupId: groups.length - 1,
      offsetMs: 0,
      durationMs: step.durationMs ?? PRESENTATION_DEFAULT_BUILD_MS,
    });
  }
  // Chain resolution inside each group: with-previous shares the previous
  // step's start; after-previous starts when the previous step ends.
  for (const group of groups) {
    for (let i = 1; i < group.length; i++) {
      const timing = group[i]!;
      const previous = group[i - 1]!;
      const chainStart =
        timing.step.trigger === 'withPrevious'
          ? previous.offsetMs
          : previous.offsetMs + previous.durationMs;
      timing.offsetMs = chainStart + (timing.step.delayMs ?? 0);
    }
    if (group.length > 0) {
      group[0]!.offsetMs = group[0]!.step.delayMs ?? 0;
    }
  }
  const autoFirstGroup = steps.length > 0 && steps[0]!.trigger !== 'onClick';
  return { groups, autoFirstGroup };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The show director owns playback state for one delivery session. It is pure
 * with respect to the document: slide transitions and build schedules are
 * captured at construction; the caller injects the clock.
 */
export class ShowDirector {
  private readonly runtimes: SlideRuntime[] = [];
  private cursor = 0;
  private readonly reducedMotion: boolean;

  constructor(inputs: readonly ScheduleInput[], options: { reducedMotion?: boolean } = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.runtimes = inputs.map((input) => ({
      transition: input.transition,
      schedule: input.schedule,
      enteredAt: Number.NaN,
      shownAt: null,
      groupZeros: input.schedule.groups.map(() => NOT_STARTED),
      allBuilt: false,
    }));
  }

  get slideIndex(): number {
    return this.cursor;
  }

  get slideCount(): number {
    return this.runtimes.length;
  }

  private runtime(index = this.cursor): SlideRuntime | undefined {
    return this.runtimes[index];
  }

  /** Effective transition for the current slide; reduced motion forces a cut. */
  effectiveTransition(index = this.cursor): PresentationTransition {
    const runtime = this.runtime(index);
    const transition = runtime?.transition ?? { kind: 'none' as const, durationMs: 0 };
    if (this.reducedMotion && transition.kind !== 'none') {
      return { ...transition, kind: 'fade', durationMs: 0 };
    }
    return transition;
  }

  /**
   * Mark the current slide as entered at `now`. Called by the host when
   * delivery arrives at (or seeks to) a slide. A slide whose effective
   * transition has zero duration settles immediately, so no click is ever
   * consumed completing a transition that does not exist.
   */
  enter(index: number, now: number, options: { built?: boolean } = {}): void {
    const runtime = this.runtimes[index];
    if (!runtime) return;
    this.cursor = index;
    runtime.enteredAt = now;
    runtime.shownAt = null;
    runtime.groupZeros = runtime.schedule.groups.map(() => NOT_STARTED);
    runtime.allBuilt = options.built ?? false;
    if (runtime.allBuilt) {
      runtime.groupZeros = runtime.schedule.groups.map(() => Number.NEGATIVE_INFINITY);
    }
    if (this.effectiveTransition(index).durationMs <= 0) {
      this.finalizeTransition(runtime, now);
    }
  }

  /**
   * Advance one deterministic step. A click during a transition completes the
   * transition; a click while a build effect is still playing completes that
   * effect; otherwise it starts the next pending build group, and only when
   * no builds remain does it change slides. One click never performs more
   * than one of these.
   */
  advance(now: number): AdvanceResult {
    const runtime = this.runtime();
    if (!runtime) return 'boundary';
    if (runtime.shownAt === null) {
      this.finalizeTransition(runtime, now);
      return 'completed-transition';
    }
    const pending = runtime.groupZeros.indexOf(NOT_STARTED);
    if (pending >= 0) {
      runtime.groupZeros[pending] = now;
      return 'started-build-group';
    }
    // Completing a running effect shifts its group's zero earlier so every
    // step in already-started groups lands done; never-started groups stay put.
    let completing = false;
    runtime.schedule.groups.forEach((group, groupId) => {
      const zero = runtime.groupZeros[groupId]!;
      if (zero === NOT_STARTED) return;
      const groupEnd = group.reduce(
        (max, timing) => Math.max(max, timing.offsetMs + timing.durationMs),
        0,
      );
      if (now < zero + groupEnd) {
        runtime.groupZeros[groupId] = Math.min(zero, now - groupEnd);
        completing = true;
      }
    });
    if (completing) return 'completed-effect';
    if (this.cursor + 1 < this.runtimes.length) {
      this.enter(this.cursor + 1, now);
      return 'advanced-slide';
    }
    return 'boundary';
  }

  /** Go to the previous slide, landing fully built. */
  previous(now: number): void {
    if (this.cursor > 0) this.enter(this.cursor - 1, now, { built: true });
  }

  /** Jump to a slide. Landing is fully built (matching presentation norms). */
  goto(index: number, now: number): void {
    if (index >= 0 && index < this.runtimes.length) this.enter(index, now, { built: true });
  }

  private finalizeTransition(runtime: SlideRuntime, now: number): void {
    runtime.shownAt = now;
    // The auto group starts exactly once, anchored at the transition end.
    if (runtime.schedule.autoFirstGroup && runtime.groupZeros[0] === NOT_STARTED) {
      runtime.groupZeros[0] = now;
    }
  }

  sample(now: number): ShowSample {
    const runtime = this.runtime();
    if (!runtime) {
      return {
        slideIndex: this.cursor,
        slideEnteredAt: now,
        phase: 'shown',
        transition: null,
        builds: [],
        startedGroups: 0,
      };
    }
    if (runtime.shownAt === null) {
      const duration = this.effectiveTransition().durationMs;
      const elapsed = now - runtime.enteredAt;
      if (duration <= 0 || elapsed >= duration) {
        this.finalizeTransition(runtime, runtime.enteredAt + Math.max(duration, 0));
      }
    }
    const inTransition = runtime.shownAt === null;
    const transition = inTransition ? this.effectiveTransition() : null;
    const transitionProgress =
      transition && transition.durationMs > 0
        ? clamp01((now - runtime.enteredAt) / transition.durationMs)
        : 1;
    const builds: BuildStepSample[] = [];
    let startedGroups = 0;
    runtime.schedule.groups.forEach((group, groupId) => {
      const zero = runtime.groupZeros[groupId]!;
      if (zero !== NOT_STARTED) startedGroups = groupId + 1;
      for (const timing of group) {
        if (zero === NOT_STARTED) {
          builds.push({ timing, state: 'pending', progress: 0 });
          continue;
        }
        const local = now - zero - timing.offsetMs;
        const duration = this.reducedMotion ? 0 : timing.durationMs;
        if (duration <= 0 || local >= duration) {
          builds.push({ timing, state: 'done', progress: 1 });
        } else if (local < 0) {
          builds.push({ timing, state: 'pending', progress: 0 });
        } else {
          builds.push({ timing, state: 'active', progress: clamp01(local / duration) });
        }
      }
    });
    return {
      slideIndex: this.cursor,
      slideEnteredAt: runtime.enteredAt,
      phase: inTransition ? 'transition' : 'shown',
      transition: transition
        ? {
            kind: transition.kind,
            durationMs: transition.durationMs,
            direction: transition.direction,
            progress: transitionProgress,
          }
        : null,
      builds,
      startedGroups,
    };
  }

  /**
   * True once the current slide's transition has completed at `now`. The host
   * uses this to swap the entering render for the settled one.
   */
  isShown(now: number): boolean {
    const runtime = this.runtime();
    if (!runtime || runtime.shownAt !== null) return runtime !== undefined;
    const duration = this.effectiveTransition().durationMs;
    return duration <= 0 || now - runtime.enteredAt >= duration;
  }
}

export function defaultTransitionDuration(): number {
  return PRESENTATION_DEFAULT_TRANSITION_MS;
}

/**
 * The authoritative show clock. Elapsed presentation time in ms with pause
 * support; every director call and every rendered sample reads this one
 * clock, so pausing can never desynchronize transition, build, and timer
 * views of the show.
 */
export class ShowClock {
  private origin = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;

  start(now: number): void {
    this.origin = now;
    this.pausedAt = null;
    this.pausedTotal = 0;
  }

  now(): number {
    const raw =
      this.pausedAt !== null ? this.pausedAt - this.origin : performance.now() - this.origin;
    return Math.max(0, raw - this.pausedTotal);
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = performance.now();
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }
}
