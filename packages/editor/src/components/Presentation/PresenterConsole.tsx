import type { ResolvedPresentationSlide } from '@varve/scene';
import { Button } from '@varve/ui';
import { useEffect, useState } from 'react';
import type { StageBitmap } from './PresentationStage';
import type { ShowDirector } from './show/showTiming';

/**
 * Presenter console.
 *
 * The presenter surface for delivery: current notes, elapsed and per-slide
 * timers, the next slide's preview, build progress, and pause/resume. It
 * mounts only in presenter view — the audience view never renders this
 * component, so notes are absent from the audience DOM rather than hidden
 * with CSS.
 */

export interface PresenterConsoleProps {
  slides: ResolvedPresentationSlide[];
  director: ShowDirector;
  clock: { now(): number; pause(): void; resume(): void; paused: boolean };
  bitmaps: ReadonlyMap<string, StageBitmap>;
  bitmapsVersion: number;
  onRequestPrevious: () => void;
  onRequestAdvance: () => void;
  onShowAudience: () => void;
}

function formatClock(totalMs: number): string {
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function PresenterConsole({
  slides,
  director,
  clock,
  bitmaps,
  bitmapsVersion,
  onRequestPrevious,
  onRequestAdvance,
  onShowAudience,
}: PresenterConsoleProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(interval);
  }, []);

  const now = clock.now();
  const sample = director.sample(now);
  const current = slides[sample.slideIndex];
  const next = slides[sample.slideIndex + 1];
  const nextBitmap = next ? bitmaps.get(next.entry.id) : undefined;
  const currentBitmap = current ? bitmaps.get(current.entry.id) : undefined;
  void bitmapsVersion;

  const done = sample.builds.filter((build) => build.state === 'done').length;
  const pending = sample.builds.filter((build) => build.state === 'pending');
  const buildsLabel =
    sample.builds.length === 0
      ? 'No builds on this slide'
      : `Build ${Math.min(done + 1, sample.builds.length)} of ${sample.builds.length}${
          pending.length > 0 ? ` — next: ${pending[0]!.timing.step.id}` : ''
        }`;

  return (
    <div className="presentation-presenter">
      <div className="presentation-presenter__timers" role="timer" aria-label="Show timers">
        <span className="presentation-presenter__timer">
          Elapsed <strong>{formatClock(now)}</strong>
        </span>
        <span className="presentation-presenter__timer">
          This slide <strong>{formatClock(Math.max(0, now - sample.slideEnteredAt))}</strong>
        </span>
        {clock.paused && <span className="presentation-presenter__paused">Paused</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => (clock.paused ? clock.resume() : clock.pause())}
        >
          {clock.paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
      <div className="presentation-presenter__grid">
        <section
          className="presentation-presenter__notes"
          aria-label={`Speaker notes for slide ${sample.slideIndex + 1}`}
        >
          <h3>Notes (private)</h3>
          <p>{current?.entry.notes?.trim() || 'No notes for this slide.'}</p>
        </section>
        <section className="presentation-presenter__next" aria-label="Next slide preview">
          <h3>Next</h3>
          {nextBitmap ? (
            <img
              src={nextBitmap.src}
              alt={next?.entry.altText ?? next?.entry.title ?? 'Next slide'}
            />
          ) : currentBitmap ? (
            <p role="status">Preparing next slide preview…</p>
          ) : (
            <p role="status">This is the last slide.</p>
          )}
        </section>
      </div>
      <p className="presentation-presenter__builds" role="status">
        {buildsLabel}
      </p>
      <div className="presentation-presenter__controls">
        <Button
          size="sm"
          variant="ghost"
          onClick={onRequestPrevious}
          disabled={sample.slideIndex === 0 && sample.phase === 'shown'}
        >
          Previous
        </Button>
        <Button size="sm" variant="default" onClick={onRequestAdvance}>
          Next
        </Button>
        <span aria-live="polite">
          Slide {sample.slideIndex + 1} of {slides.length}
        </span>
        <Button size="sm" variant="ghost" onClick={onShowAudience}>
          Audience view
        </Button>
      </div>
    </div>
  );
}
