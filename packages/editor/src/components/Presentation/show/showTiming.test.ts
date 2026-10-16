import type { PresentationBuildStep } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeBuildSchedule, type ScheduleInput, ShowDirector } from './showTiming';

function step(overrides: Partial<PresentationBuildStep> & { id: string }): PresentationBuildStep {
  return {
    nodeId: 'node-1',
    effect: 'fade',
    trigger: 'onClick',
    ...overrides,
  };
}

function director(
  slides: Array<{
    transition?: { kind: 'fade' | 'none'; durationMs: number };
    steps: PresentationBuildStep[];
  }>,
  options: { reducedMotion?: boolean } = {},
): ShowDirector {
  const inputs: ScheduleInput[] = slides.map((slide) => ({
    transition: slide.transition ?? { kind: 'none', durationMs: 0 },
    schedule: computeBuildSchedule(slide.steps),
  }));
  return new ShowDirector(inputs, options);
}

describe('computeBuildSchedule', () => {
  it('opens a click group per onClick step and chains with/after previous inside a group', () => {
    const schedule = computeBuildSchedule([
      step({ id: 'a' }),
      step({ id: 'b', trigger: 'withPrevious', delayMs: 100 }),
      step({ id: 'c', trigger: 'afterPrevious' }),
      step({ id: 'd' }),
    ]);
    expect(schedule.groups).toHaveLength(2);
    expect(schedule.autoFirstGroup).toBe(false);
    expect(schedule.groups[0]!.map((t) => t.step.id)).toEqual(['a', 'b', 'c']);
    expect(schedule.groups[1]!.map((t) => t.step.id)).toEqual(['d']);
    const [a, b, c] = schedule.groups[0]!;
    expect(a!.offsetMs).toBe(0);
    expect(b!.offsetMs).toBe(100);
    expect(c!.offsetMs).toBe(b!.durationMs + 100);
  });

  it('marks the first group automatic only when the first step is not onClick', () => {
    expect(computeBuildSchedule([step({ id: 'a', trigger: 'afterPrevious' })]).autoFirstGroup).toBe(
      true,
    );
    expect(computeBuildSchedule([step({ id: 'a' })]).autoFirstGroup).toBe(false);
    expect(computeBuildSchedule([]).autoFirstGroup).toBe(false);
    expect(computeBuildSchedule([]).groups).toHaveLength(0);
  });
});

describe('ShowDirector transitions', () => {
  it('plays a fractional duration exactly instead of rounding it to one second', () => {
    const d = director([{ transition: { kind: 'fade', durationMs: 333.5 }, steps: [] }]);
    d.enter(0, 1000);
    let sample = d.sample(1000);
    expect(sample.phase).toBe('transition');
    expect(sample.transition?.progress).toBe(0);
    sample = d.sample(1166.75);
    expect(sample.transition?.progress).toBeCloseTo(0.5, 5);
    expect(sample.phase).toBe('transition');
    sample = d.sample(1333.5);
    expect(sample.phase).toBe('shown');
    expect(sample.transition).toBeNull();
  });

  it('does not consume a click completing a zero-duration transition', () => {
    const d = director([
      { transition: { kind: 'none', durationMs: 0 }, steps: [step({ id: 'a' })] },
      { steps: [] },
    ]);
    d.enter(0, 1000);
    expect(d.sample(1000).phase).toBe('shown');
    expect(d.advance(1010)).toBe('started-build-group');
    // A click while the fade build is playing completes it; the next click
    // changes slides.
    expect(d.advance(1020)).toBe('completed-effect');
    expect(d.advance(1030)).toBe('advanced-slide');
  });

  it('completes a zero-duration transition immediately', () => {
    const d = director([{ transition: { kind: 'none', durationMs: 0 }, steps: [] }]);
    d.enter(0, 1000);
    expect(d.sample(1000).phase).toBe('shown');
  });

  it('a click during a real transition completes the transition and nothing else', () => {
    const d = director([
      { transition: { kind: 'fade', durationMs: 500 }, steps: [step({ id: 'a' })] },
      { steps: [] },
    ]);
    d.enter(0, 0);
    expect(d.advance(200)).toBe('completed-transition');
    const sample = d.sample(200);
    expect(sample.phase).toBe('shown');
    expect(sample.builds[0]?.state).toBe('pending');
    expect(d.slideIndex).toBe(0);
  });

  it('reaches the end with a boundary and never wraps silently', () => {
    const d = director([{ steps: [] }, { steps: [] }]);
    d.enter(0, 0);
    expect(d.advance(10)).toBe('advanced-slide');
    expect(d.advance(20)).toBe('boundary');
    expect(d.slideIndex).toBe(1);
  });
});

describe('ShowDirector builds', () => {
  it('starts one click group per click, then advances only when builds are exhausted', () => {
    const d = director([
      {
        steps: [
          step({ id: 'a' }),
          step({ id: 'b' }),
          step({ id: 'c', trigger: 'afterPrevious', durationMs: 250 }),
        ],
      },
      { steps: [] },
    ]);
    d.enter(0, 0);
    expect(d.advance(10)).toBe('started-build-group');
    // b and its after-previous chain belong to the next click group.
    expect(d.advance(20)).toBe('started-build-group');
    // c starts exactly when b (400ms default) ends, not at the click instant.
    expect(d.sample(20).builds.find((b) => b.timing.step.id === 'c')?.state).toBe('pending');
    expect(d.sample(430).builds.find((b) => b.timing.step.id === 'c')?.state).toBe('active');
    // A click while c is playing completes it; the next click changes slides.
    expect(d.advance(450)).toBe('completed-effect');
    expect(d.sample(450).builds.find((b) => b.timing.step.id === 'c')?.state).toBe('done');
    expect(d.advance(460)).toBe('advanced-slide');
    expect(d.slideIndex).toBe(1);
  });

  it('starts the automatic first group exactly once when the transition completes', () => {
    const d = director([
      {
        transition: { kind: 'fade', durationMs: 100 },
        steps: [step({ id: 'a', trigger: 'afterPrevious' }), step({ id: 'b' })],
      },
    ]);
    d.enter(0, 0);
    // Sampling past the transition end finalizes it; the auto group starts once.
    const sample = d.sample(500);
    expect(sample.phase).toBe('shown');
    const auto = sample.builds.find((b) => b.timing.step.id === 'a');
    const clicked = sample.builds.find((b) => b.timing.step.id === 'b');
    expect(auto?.state).toBe('done');
    expect(clicked?.state).toBe('pending');
    // Repeated sampling and clicking must not re-trigger or double-start it.
    d.sample(600);
    d.sample(700);
    expect(d.advance(800)).toBe('started-build-group');
    const after = d.sample(800);
    expect(after.builds.find((b) => b.timing.step.id === 'b')?.state).toBe('active');
    expect(after.startedGroups).toBe(2);
  });

  it('reports active fractional progress for running effects', () => {
    const d = director([{ steps: [step({ id: 'a', durationMs: 333.5, delayMs: 66.5 })] }]);
    d.enter(0, 0);
    d.advance(1000);
    const sample = d.sample(1000 + 66.5 + 166.75);
    const a = sample.builds[0]!;
    expect(a.state).toBe('active');
    expect(a.progress).toBeCloseTo(0.5, 5);
    expect(d.sample(1000 + 66.5 + 333.5).builds[0]?.state).toBe('done');
  });

  it('lands fully built on previous and goto without starting any effect', () => {
    const d = director([{ steps: [step({ id: 'a' })] }, { steps: [step({ id: 'b' })] }]);
    d.enter(0, 0);
    d.advance(10);
    d.advance(20);
    d.previous(30);
    expect(d.slideIndex).toBe(0);
    expect(d.sample(30).builds[0]?.state).toBe('done');
    d.goto(1, 40);
    expect(d.slideIndex).toBe(1);
    expect(d.sample(40).builds[0]?.state).toBe('done');
  });
});

describe('ShowDirector reduced motion', () => {
  it('keeps the logical build sequence with immediate effects and a cut transition', () => {
    const d = director(
      [
        {
          transition: { kind: 'fade', durationMs: 500 },
          steps: [step({ id: 'a', trigger: 'afterPrevious', durationMs: 400 }), step({ id: 'b' })],
        },
      ],
      { reducedMotion: true },
    );
    d.enter(0, 0);
    const sample = d.sample(0);
    expect(sample.phase).toBe('shown');
    expect(sample.builds[0]?.state).toBe('done');
    expect(sample.builds[1]?.state).toBe('pending');
    expect(d.advance(1)).toBe('started-build-group');
    expect(d.sample(1).builds[1]?.state).toBe('done');
  });
});
