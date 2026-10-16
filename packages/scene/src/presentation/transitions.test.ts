import { describe, expect, it } from 'vitest';
import {
  isValidPresentationBuild,
  isValidPresentationTransition,
  normalizePresentationBuilds,
  resolveSlideTransition,
} from './transitions';
import type { PresentationDeck, PresentationSlideEntry } from './types';
import {
  MAX_PRESENTATION_BUILDS_PER_SLIDE,
  PRESENTATION_BUILD_DELAY_LIMIT_MS,
  PRESENTATION_BUILD_DURATION_LIMIT_MS,
  PRESENTATION_TRANSITION_DURATION_LIMIT_MS,
} from './types';

function makeDeck(overrides: Partial<PresentationDeck> = {}): PresentationDeck {
  return {
    id: 'deck',
    name: 'Deck',
    width: 1920,
    height: 1080,
    slides: [],
    sections: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PresentationSlideEntry> = {}): PresentationSlideEntry {
  return { id: 'one', frameId: 'frame-1', title: 'One', ...overrides };
}

describe('isValidPresentationTransition', () => {
  it('accepts every documented kind with fractional durations', () => {
    for (const kind of ['none', 'fade', 'slide', 'push', 'wipe', 'morph'] as const) {
      expect(isValidPresentationTransition({ kind, durationMs: 499.5 })).toBe(true);
    }
  });

  it('accepts durations at the exact limit including zero', () => {
    expect(
      isValidPresentationTransition({
        kind: 'fade',
        durationMs: PRESENTATION_TRANSITION_DURATION_LIMIT_MS,
      }),
    ).toBe(true);
    expect(isValidPresentationTransition({ kind: 'fade', durationMs: 0 })).toBe(true);
  });

  it('rejects unknown kinds, negative or non-finite durations, bad directions and easings', () => {
    expect(isValidPresentationTransition({ kind: 'cube', durationMs: 500 })).toBe(false);
    expect(isValidPresentationTransition({ kind: 'fade', durationMs: -1 })).toBe(false);
    expect(
      isValidPresentationTransition({ kind: 'fade', durationMs: Number.POSITIVE_INFINITY }),
    ).toBe(false);
    expect(
      isValidPresentationTransition({
        kind: 'fade',
        durationMs: 500,
        direction: 'diagonal',
      }),
    ).toBe(false);
    expect(
      isValidPresentationTransition({ kind: 'fade', durationMs: 500, easing: 'easeInOut' }),
    ).toBe(false);
    expect(
      isValidPresentationTransition({
        kind: 'fade',
        durationMs: 500,
        easing: { kind: 'easeInOut' },
      }),
    ).toBe(true);
  });
});

describe('isValidPresentationBuild', () => {
  it('accepts by-paragraph ranges and zero-duration steps', () => {
    expect(
      isValidPresentationBuild({
        id: 'b1',
        nodeId: 'node-1',
        effect: 'flyIn',
        trigger: 'afterPrevious',
        durationMs: 0,
        delayMs: 250.25,
        direction: 'up',
        paragraphRange: { from: 0, to: 3 },
      }),
    ).toBe(true);
  });

  it('rejects inverted paragraph ranges and out-of-bound timings', () => {
    expect(
      isValidPresentationBuild({
        id: 'b1',
        nodeId: 'node-1',
        effect: 'fade',
        trigger: 'onClick',
        paragraphRange: { from: 4, to: 1 },
      }),
    ).toBe(false);
    expect(
      isValidPresentationBuild({
        id: 'b1',
        nodeId: 'node-1',
        effect: 'fade',
        trigger: 'onClick',
        durationMs: PRESENTATION_BUILD_DURATION_LIMIT_MS + 1,
      }),
    ).toBe(false);
    expect(
      isValidPresentationBuild({
        id: 'b1',
        nodeId: 'node-1',
        effect: 'fade',
        trigger: 'onClick',
        delayMs: PRESENTATION_BUILD_DELAY_LIMIT_MS + 1,
      }),
    ).toBe(false);
  });
});

describe('normalizePresentationBuilds', () => {
  it('caps the list at the documented bound', () => {
    const builds = Array.from({ length: MAX_PRESENTATION_BUILDS_PER_SLIDE + 10 }, (_, index) => ({
      id: `b${index}`,
      nodeId: 'node-1',
      effect: 'appear',
      trigger: 'onClick',
    }));
    expect(normalizePresentationBuilds(builds)).toHaveLength(MAX_PRESENTATION_BUILDS_PER_SLIDE);
  });

  it('returns undefined for empty and non-array input', () => {
    expect(normalizePresentationBuilds([])).toBeUndefined();
    expect(normalizePresentationBuilds('nope')).toBeUndefined();
  });
});

describe('resolveSlideTransition', () => {
  it('prefers the entry transition over the deck default, then falls back to a cut', () => {
    const deck = makeDeck({ defaultTransition: { kind: 'fade', durationMs: 300 } });
    const entry = makeEntry({ transition: { kind: 'push', durationMs: 700.5 } });
    expect(resolveSlideTransition(deck, entry)).toEqual({
      kind: 'push',
      durationMs: 700.5,
      direction: 'left',
    });
    expect(resolveSlideTransition(deck, makeEntry())).toEqual({ kind: 'fade', durationMs: 300 });
    expect(resolveSlideTransition(makeDeck(), makeEntry())).toEqual({
      kind: 'none',
      durationMs: 0,
    });
  });

  it('supplies the default direction only for directional kinds', () => {
    const deck = makeDeck();
    expect(
      resolveSlideTransition(deck, makeEntry({ transition: { kind: 'wipe', durationMs: 250 } })),
    ).toEqual({ kind: 'wipe', durationMs: 250, direction: 'left' });
    expect(
      resolveSlideTransition(deck, makeEntry({ transition: { kind: 'fade', durationMs: 250 } })),
    ).toEqual({ kind: 'fade', durationMs: 250 });
    expect(
      resolveSlideTransition(
        deck,
        makeEntry({
          transition: { kind: 'slide', durationMs: 250, direction: 'up' },
        }),
      ),
    ).toEqual({ kind: 'slide', durationMs: 250, direction: 'up' });
  });

  it('never mutates or rounds the authored duration', () => {
    const durationMs = 733.3333333;
    const deck = makeDeck({ defaultTransition: { kind: 'morph', durationMs } });
    const resolved = resolveSlideTransition(deck, makeEntry());
    expect(resolved.durationMs).toBe(durationMs);
    expect(deck.defaultTransition?.durationMs).toBe(durationMs);
  });
});
