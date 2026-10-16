import { describe, expect, it } from 'vitest';
import { normalizePresentationMetadata } from './normalize';
import { PRESENTATION_SCHEMA_VERSION } from './types';

describe('normalizePresentationMetadata', () => {
  it('preserves missing frame references, order and notes while normalizing unsafe dimensions', () => {
    expect(
      normalizePresentationMetadata({
        schemaVersion: 1,
        decks: [
          {
            id: 'deck',
            name: 'Review',
            width: Number.NaN,
            height: -1,
            slides: [
              { id: 'first', frameId: 'removed-frame', title: 'First', notes: 'Recovery notes' },
              { id: 'second', frameId: 'frame-2', title: 'Second', skipped: true },
            ],
            sections: [],
          },
        ],
      }),
    ).toEqual({
      schemaVersion: PRESENTATION_SCHEMA_VERSION,
      decks: [
        {
          id: 'deck',
          name: 'Review',
          width: 1920,
          height: 1080,
          slides: [
            { id: 'first', frameId: 'removed-frame', title: 'First', notes: 'Recovery notes' },
            { id: 'second', frameId: 'frame-2', title: 'Second', skipped: true },
          ],
          sections: [],
        },
      ],
      layouts: [],
      themes: [],
    });
  });

  it('upgrades a version 1 envelope to the current version without inventing transitions', () => {
    const normalized = normalizePresentationMetadata({
      schemaVersion: 1,
      decks: [
        {
          id: 'deck',
          name: 'Deck',
          width: 1920,
          height: 1080,
          slides: [{ id: 'one', frameId: 'frame-1', title: 'One' }],
          sections: [],
        },
      ],
    });
    expect(normalized?.schemaVersion).toBe(PRESENTATION_SCHEMA_VERSION);
    expect(normalized?.decks[0]?.slides[0]).toEqual({
      id: 'one',
      frameId: 'frame-1',
      title: 'One',
    });
  });

  it('preserves fractional transition durations and valid builds exactly', () => {
    const normalized = normalizePresentationMetadata({
      schemaVersion: PRESENTATION_SCHEMA_VERSION,
      decks: [
        {
          id: 'deck',
          name: 'Deck',
          width: 1920,
          height: 1080,
          sections: [],
          defaultTransition: { kind: 'fade', durationMs: 333.5 },
          slides: [
            {
              id: 'one',
              frameId: 'frame-1',
              title: 'One',
              transition: { kind: 'morph', durationMs: 0.75, easing: { kind: 'easeInOut' } },
              builds: [
                {
                  id: 'b1',
                  nodeId: 'node-1',
                  effect: 'flyIn',
                  trigger: 'onClick',
                  delayMs: 120.25,
                  durationMs: 0,
                  direction: 'right',
                  paragraphRange: { from: 0, to: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
    const slide = normalized?.decks[0]?.slides[0];
    expect(slide?.transition).toEqual({
      kind: 'morph',
      durationMs: 0.75,
      easing: { kind: 'easeInOut' },
    });
    expect(slide?.builds?.[0]?.durationMs).toBe(0);
    expect(slide?.builds?.[0]?.delayMs).toBe(120.25);
    expect(normalized?.decks[0]?.defaultTransition).toEqual({ kind: 'fade', durationMs: 333.5 });
  });

  it('drops invalid transitions, builds and out-of-range values instead of failing the document', () => {
    const normalized = normalizePresentationMetadata({
      schemaVersion: PRESENTATION_SCHEMA_VERSION,
      decks: [
        {
          id: 'deck',
          name: 'Deck',
          width: 1920,
          height: 1080,
          sections: [],
          slides: [
            {
              id: 'one',
              frameId: 'frame-1',
              title: 'One',
              transition: { kind: 'spin', durationMs: -5 },
              builds: [
                { id: 'good', nodeId: 'node-1', effect: 'fade', trigger: 'onClick' },
                { id: 'bad', nodeId: 'node-2', effect: 'explode', trigger: 'sometimes' },
                {
                  id: 'oob',
                  nodeId: 'node-3',
                  effect: 'fade',
                  trigger: 'onClick',
                  durationMs: 1e9,
                },
                {
                  id: 'bad-range',
                  nodeId: 'node-4',
                  effect: 'fade',
                  trigger: 'onClick',
                  paragraphRange: { from: 5, to: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
    const slide = normalized?.decks[0]?.slides[0];
    expect(slide?.transition).toBeUndefined();
    expect(slide?.builds).toEqual([
      { id: 'good', nodeId: 'node-1', effect: 'fade', trigger: 'onClick' },
    ]);
  });

  it('still declines to rewrite a genuinely unknown metadata schema version', () => {
    expect(normalizePresentationMetadata({ schemaVersion: 99, decks: [] })).toBeUndefined();
  });
});
