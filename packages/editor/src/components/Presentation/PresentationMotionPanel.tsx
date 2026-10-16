import {
  type Document,
  MAX_PRESENTATION_BUILDS_PER_SLIDE,
  PRESENTATION_BUILD_EFFECTS,
  PRESENTATION_BUILD_TRIGGERS,
  PRESENTATION_TRANSITION_DIRECTIONS,
  PRESENTATION_TRANSITION_KINDS,
  type PresentationBuildEffect,
  type PresentationBuildStep,
  type PresentationBuildTrigger,
  type PresentationDeck,
  type PresentationSlideEntry,
  type PresentationTransition,
  type PresentationTransitionDirection,
  type PresentationTransitionKind,
} from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useState } from 'react';
import './presentationNavigator.css';

/**
 * Per-slide motion authoring: the transition into this slide and its object
 * builds. Every edit lands as one canonical presentation operation, so undo,
 * replay, and persistence behave like every other slide edit.
 */

const TRANSITION_LABELS: Record<PresentationTransitionKind, string> = {
  none: 'None (cut)',
  fade: 'Fade',
  slide: 'Slide',
  push: 'Push',
  wipe: 'Wipe',
  morph: 'Morph (match by name)',
};

const DIRECTION_LABELS: Record<PresentationTransitionDirection, string> = {
  left: 'From right',
  right: 'From left',
  up: 'From bottom',
  down: 'From top',
};

const EFFECT_LABELS: Record<PresentationBuildEffect, string> = {
  appear: 'Appear',
  fade: 'Fade in',
  flyIn: 'Fly in',
  flyOut: 'Fly out (exit)',
  wipe: 'Wipe in',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out (exit)',
  pulse: 'Pulse (emphasis)',
};

const TRIGGER_LABELS: Record<PresentationBuildTrigger, string> = {
  onClick: 'On click',
  withPrevious: 'With previous',
  afterPrevious: 'After previous',
};

function directionalKind(kind: PresentationTransitionKind): boolean {
  return kind === 'slide' || kind === 'push' || kind === 'wipe';
}

interface PresentationMotionPanelProps {
  deck: PresentationDeck;
  entry: PresentationSlideEntry;
  document: Document;
  runOperation: (label: string, type: string, payload: unknown) => void;
}

export function PresentationMotionPanel({
  deck,
  entry,
  document,
  runOperation,
}: PresentationMotionPanelProps) {
  const [kindDraft, setKindDraft] = useState<PresentationTransitionKind>('fade');
  const [durationDraft, setDurationDraft] = useState('500');
  const [directionDraft, setDirectionDraft] = useState<PresentationTransitionDirection>('left');
  const [targetDraft, setTargetDraft] = useState('');
  const [effectDraft, setEffectDraft] = useState<PresentationBuildEffect>('fade');
  const [triggerDraft, setTriggerDraft] = useState<PresentationBuildTrigger>('onClick');
  const [buildDurationDraft, setBuildDurationDraft] = useState('400');
  const [buildDirectionDraft, setBuildDirectionDraft] =
    useState<PresentationTransitionDirection>('left');
  const [paragraphDraft, setParagraphDraft] = useState(false);
  const [paragraphFromDraft, setParagraphFromDraft] = useState('0');
  const [paragraphToDraft, setParagraphToDraft] = useState('0');

  const frame = document.nodes[entry.frameId];
  const children =
    frame?.kind === 'frame' || frame?.kind === 'group'
      ? (frame.children ?? [])
          .map((childId) => document.nodes[childId])
          .filter((child): child is NonNullable<typeof child> => Boolean(child))
      : [];

  const transition = entry.transition ?? null;
  const builds = entry.builds ?? [];

  const setTransition = (next: PresentationTransition | null) => {
    runOperation(
      next === null ? 'Reset slide transition' : `Set slide transition (${next.kind})`,
      'presentation.slide.setTransition',
      { deckId: deck.id, entryId: entry.id, transition: next },
    );
  };

  const commitTransitionDraft = () => {
    const parsed = Number.parseFloat(durationDraft);
    setTransition({
      kind: kindDraft,
      durationMs: Number.isFinite(parsed) && parsed >= 0 ? parsed : 500,
      ...(directionalKind(kindDraft) ? { direction: directionDraft } : {}),
    });
  };

  const setBuilds = (next: PresentationBuildStep[], label: string) => {
    runOperation(label, 'presentation.slide.setBuilds', {
      deckId: deck.id,
      entryId: entry.id,
      builds: next,
    });
  };

  const moveBuild = (index: number, delta: 1 | -1) => {
    const to = index + delta;
    if (to < 0 || to >= builds.length) return;
    const next = [...builds];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    setBuilds(next, 'Reorder slide builds');
  };

  const addBuild = () => {
    if (!targetDraft || builds.length >= MAX_PRESENTATION_BUILDS_PER_SLIDE) return;
    const parsedDuration = Number.parseFloat(buildDurationDraft);
    const from = Number.parseInt(paragraphFromDraft, 10);
    const to = Number.parseInt(paragraphToDraft, 10);
    const step: PresentationBuildStep = {
      id: `build-${Date.now().toString(36)}-${builds.length}`,
      nodeId: targetDraft,
      effect: effectDraft,
      trigger: triggerDraft,
      ...(!Number.isNaN(parsedDuration) && parsedDuration >= 0
        ? { durationMs: parsedDuration }
        : {}),
      ...(directionalKind(effectDraft === 'wipe' ? 'wipe' : 'slide') &&
      (effectDraft === 'flyIn' || effectDraft === 'flyOut')
        ? { direction: buildDirectionDraft }
        : {}),
      ...(paragraphDraft && !Number.isNaN(from) && !Number.isNaN(to) && from >= 0 && to >= from
        ? { paragraphRange: { from, to } }
        : {}),
    };
    setBuilds([...builds, step], `Add slide build (${EFFECT_LABELS[effectDraft]})`);
    setTargetDraft('');
  };

  const targetName = (nodeId: string) => document.nodes[nodeId]?.name || nodeId;

  return (
    <div className="presentation-motion">
      <fieldset className="presentation-motion__group">
        <legend>Transition into this slide</legend>
        {transition ? (
          <p className="presentation-motion__current">
            {TRANSITION_LABELS[transition.kind]}
            {transition.direction ? ` (${DIRECTION_LABELS[transition.direction]})` : ''} —{' '}
            {transition.durationMs} ms
          </p>
        ) : (
          <p className="presentation-motion__current">
            {deck.defaultTransition
              ? `Deck default: ${TRANSITION_LABELS[deck.defaultTransition.kind]}`
              : 'None (cut)'}
          </p>
        )}
        <div className="presentation-motion__row">
          <Select
            label="Transition kind"
            aria-label="Transition kind"
            value={kindDraft}
            onValueChange={(value) => setKindDraft(value as PresentationTransitionKind)}
            options={PRESENTATION_TRANSITION_KINDS.map((kind) => ({
              value: kind,
              label: TRANSITION_LABELS[kind],
            }))}
          />
          {directionalKind(kindDraft) && (
            <Select
              label="Transition direction"
              aria-label="Transition direction"
              value={directionDraft}
              onValueChange={(value) => setDirectionDraft(value as PresentationTransitionDirection)}
              options={PRESENTATION_TRANSITION_DIRECTIONS.map((direction) => ({
                value: direction,
                label: DIRECTION_LABELS[direction],
              }))}
            />
          )}
        </div>
        <div className="presentation-motion__row">
          <label className="presentation-navigator__field">
            <span>Duration (ms, fractions allowed)</span>
            <input
              type="number"
              step="any"
              min={0}
              max={60_000}
              value={durationDraft}
              onChange={(event) => setDurationDraft(event.currentTarget.value)}
            />
          </label>
          <Button size="sm" variant="ghost" onClick={commitTransitionDraft}>
            Apply transition
          </Button>
        </div>
        <div className="presentation-motion__row">
          {transition && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setTransition(null)}
              disabled={!transition}
            >
              Use deck default
            </Button>
          )}
          {transition && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                runOperation(
                  `Set deck default transition (${transition.kind})`,
                  'presentation.deck.setTransition',
                  { deckId: deck.id, transition },
                )
              }
            >
              Make deck default
            </Button>
          )}
          {deck.defaultTransition && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                runOperation('Reset deck default transition', 'presentation.deck.setTransition', {
                  deckId: deck.id,
                  transition: null,
                })
              }
            >
              Clear deck default
            </Button>
          )}
        </div>
      </fieldset>

      <fieldset className="presentation-motion__group">
        <legend>Builds</legend>
        {builds.length === 0 ? (
          <p className="presentation-motion__current">No builds. Objects appear with the slide.</p>
        ) : (
          <ol className="presentation-motion__builds">
            {builds.map((build, index) => (
              <li key={build.id} className="presentation-motion__build">
                <span className="presentation-motion__build-summary">
                  {index + 1}. {targetName(build.nodeId)} — {EFFECT_LABELS[build.effect]} —{' '}
                  {TRIGGER_LABELS[build.trigger]} — {build.durationMs ?? 400} ms
                  {build.paragraphRange
                    ? ` — paragraphs ${build.paragraphRange.from}–${build.paragraphRange.to}`
                    : ''}
                </span>
                <span className="presentation-motion__build-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move build ${index + 1} earlier`}
                    onClick={() => moveBuild(index, -1)}
                    disabled={index === 0}
                  >
                    Earlier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move build ${index + 1} later`}
                    onClick={() => moveBuild(index, 1)}
                    disabled={index === builds.length - 1}
                  >
                    Later
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove build ${index + 1}`}
                    onClick={() =>
                      setBuilds(
                        builds.filter((candidate) => candidate.id !== build.id),
                        'Remove slide build',
                      )
                    }
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="presentation-motion__row">
          <Select
            label="Build target"
            aria-label="Build target"
            value={targetDraft}
            onValueChange={setTargetDraft}
            options={[
              { value: '', label: 'Choose an object' },
              ...children.map((child) => ({ value: child.id, label: child.name || child.id })),
            ]}
          />
          <Select
            label="Build effect"
            aria-label="Build effect"
            value={effectDraft}
            onValueChange={(value) => setEffectDraft(value as PresentationBuildEffect)}
            options={PRESENTATION_BUILD_EFFECTS.map((effect) => ({
              value: effect,
              label: EFFECT_LABELS[effect],
            }))}
          />
          <Select
            label="Build trigger"
            aria-label="Build trigger"
            value={triggerDraft}
            onValueChange={(value) => setTriggerDraft(value as PresentationBuildTrigger)}
            options={PRESENTATION_BUILD_TRIGGERS.map((trigger) => ({
              value: trigger,
              label: TRIGGER_LABELS[trigger],
            }))}
          />
        </div>
        <div className="presentation-motion__row">
          {(effectDraft === 'flyIn' || effectDraft === 'flyOut') && (
            <Select
              label="Build direction"
              aria-label="Build direction"
              value={buildDirectionDraft}
              onValueChange={(value) =>
                setBuildDirectionDraft(value as PresentationTransitionDirection)
              }
              options={PRESENTATION_TRANSITION_DIRECTIONS.map((direction) => ({
                value: direction,
                label: DIRECTION_LABELS[direction],
              }))}
            />
          )}
          <label className="presentation-navigator__field">
            <span>Duration (ms)</span>
            <input
              type="number"
              step="any"
              min={0}
              max={120_000}
              value={buildDurationDraft}
              onChange={(event) => setBuildDurationDraft(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="presentation-motion__row">
          <label className="presentation-motion__checkbox">
            <input
              type="checkbox"
              checked={paragraphDraft}
              onChange={(event) => setParagraphDraft(event.currentTarget.checked)}
            />
            <span>By paragraph (text objects)</span>
          </label>
          {paragraphDraft && (
            <>
              <label className="presentation-navigator__field">
                <span>First paragraph</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={paragraphFromDraft}
                  onChange={(event) => setParagraphFromDraft(event.currentTarget.value)}
                />
              </label>
              <label className="presentation-navigator__field">
                <span>Last paragraph</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={paragraphToDraft}
                  onChange={(event) => setParagraphToDraft(event.currentTarget.value)}
                />
              </label>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={addBuild}
            disabled={!targetDraft || builds.length >= MAX_PRESENTATION_BUILDS_PER_SLIDE}
          >
            Add build
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
