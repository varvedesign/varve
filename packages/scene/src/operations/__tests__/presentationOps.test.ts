import { describe, expect, it } from 'vitest';
import type { Document } from '../../document';
import { createDocument, makeFrameNode } from '../../document';
import { registerBuiltinOperations } from '../bootstrap';
import { applyOperation, hasOperation, preconditionFailure, validatePayload } from '../registry';
import { createTransactionSession } from '../transaction';

registerBuiltinOperations();

function docWithFrames(...frames: ReturnType<typeof makeFrameNode>[]): Document {
  return {
    ...createDocument('Presentation operations', true),
    nodes: Object.fromEntries(frames.map((frame) => [frame.id, frame])),
  };
}

function commitPresentationOperation<T>(document: Document, type: string, payload: T): Document {
  const session = createTransactionSession(document, {
    documentId: document.id,
    actor: { actorId: 'presentation-test', kind: 'local-user' },
    source: 'presentation',
    baseRevisionId: 'presentation-test-base',
  });
  const appended = session.append(type, payload);
  if (!appended.ok) throw new Error(appended.errors.join('; '));
  const committed = session.commit();
  if (!committed) throw new Error('expected a committed presentation operation');
  const replayed = committed.operations.reduce(
    (replayed, operation) => applyOperation(replayed, operation.operationType, operation.payload),
    document,
  );
  expect(replayed.presentation).toEqual(committed.document.presentation);
  return committed.document;
}

describe('presentation operations', () => {
  it('registers typed deck, slide and section operations', () => {
    expect(
      [
        'presentation.deck.create',
        'presentation.deck.delete',
        'presentation.deck.rename',
        'presentation.slide.add',
        'presentation.slide.remove',
        'presentation.slide.update',
        'presentation.slide.reorder',
        'presentation.slide.setTransition',
        'presentation.slide.setBuilds',
        'presentation.deck.setTransition',
        'presentation.section.create',
        'presentation.section.rename',
        'presentation.section.delete',
      ].every(hasOperation),
    ).toBe(true);
  });

  it('validates payloads and rejects repeated frame references within a deck', () => {
    expect(
      validatePayload('presentation.deck.create', {
        id: 'd',
        name: 'Deck',
        width: 1920,
        height: 1080,
      }).ok,
    ).toBe(true);
    expect(
      validatePayload('presentation.deck.create', { id: 'd', name: '', width: 0, height: 0 }).ok,
    ).toBe(false);
    let document = docWithFrames(makeFrameNode('frame-a'));
    document = applyOperation(document, 'presentation.deck.create', {
      id: 'deck',
      name: 'Quarterly',
      width: 1920,
      height: 1080,
    });
    const payload = {
      deckId: 'deck',
      entry: { id: 'slide-a', frameId: 'frame-a', title: 'Opening' },
    };
    expect(preconditionFailure(document, 'presentation.slide.add', payload)).toBeNull();
    document = applyOperation(document, 'presentation.slide.add', payload);
    expect(
      preconditionFailure(document, 'presentation.slide.add', {
        deckId: 'deck',
        entry: { id: 'slide-b', frameId: 'frame-a', title: 'Duplicate' },
      }),
    ).toContain('already appears');
    expect(() =>
      applyOperation(document, 'presentation.slide.add', {
        deckId: 'deck',
        entry: { id: 'slide-b', frameId: 'frame-a', title: 'Duplicate' },
      }),
    ).toThrow('already appears');
  });

  it('reorders, edits, and groups slides through replayable operations', () => {
    let document = docWithFrames(makeFrameNode('frame-a'), makeFrameNode('frame-b'));
    document = commitPresentationOperation(document, 'presentation.deck.create', {
      id: 'deck',
      name: 'Technical review',
      width: 1920,
      height: 1080,
    });
    document = commitPresentationOperation(document, 'presentation.section.create', {
      deckId: 'deck',
      section: { id: 'section-a', title: 'Evidence' },
    });
    document = commitPresentationOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: 'slide-a', frameId: 'frame-a', title: 'Opening', notes: 'Private notes' },
    });
    document = commitPresentationOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: 'slide-b', frameId: 'frame-b', title: 'Evidence' },
    });
    document = commitPresentationOperation(document, 'presentation.slide.update', {
      deckId: 'deck',
      entryId: 'slide-a',
      update: { sectionId: 'section-a', skipped: true },
    });
    document = commitPresentationOperation(document, 'presentation.slide.reorder', {
      deckId: 'deck',
      entryId: 'slide-a',
      toIndex: 1,
    });

    expect(document.presentation?.decks[0]?.slides.map((slide) => slide.id)).toEqual([
      'slide-b',
      'slide-a',
    ]);
    expect(document.presentation?.decks[0]?.slides[1]).toMatchObject({
      notes: 'Private notes',
      skipped: true,
      sectionId: 'section-a',
    });
  });

  it('sets and clears transitions with fractional durations through replayable operations', () => {
    let document = docWithFrames(makeFrameNode('frame-a'), makeFrameNode('frame-b'));
    document = commitPresentationOperation(document, 'presentation.deck.create', {
      id: 'deck',
      name: 'Timing',
      width: 1920,
      height: 1080,
    });
    document = commitPresentationOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: 'slide-a', frameId: 'frame-a', title: 'Opening' },
    });
    document = commitPresentationOperation(document, 'presentation.deck.setTransition', {
      deckId: 'deck',
      transition: { kind: 'fade', durationMs: 333.5 },
    });
    expect(document.presentation?.decks[0]?.defaultTransition).toEqual({
      kind: 'fade',
      durationMs: 333.5,
    });
    document = commitPresentationOperation(document, 'presentation.slide.setTransition', {
      deckId: 'deck',
      entryId: 'slide-a',
      transition: { kind: 'morph', durationMs: 0.75, easing: { kind: 'easeInOut' } },
    });
    expect(document.presentation?.decks[0]?.slides[0]?.transition).toEqual({
      kind: 'morph',
      durationMs: 0.75,
      easing: { kind: 'easeInOut' },
    });
    document = commitPresentationOperation(document, 'presentation.slide.setTransition', {
      deckId: 'deck',
      entryId: 'slide-a',
      transition: null,
    });
    expect(document.presentation?.decks[0]?.slides[0]?.transition).toBeUndefined();
    document = commitPresentationOperation(document, 'presentation.deck.setTransition', {
      deckId: 'deck',
      transition: null,
    });
    expect(document.presentation?.decks[0]?.defaultTransition).toBeUndefined();

    expect(
      validatePayload('presentation.slide.setTransition', {
        deckId: 'deck',
        entryId: 'slide-a',
        transition: { kind: 'spin', durationMs: 500 },
      }).ok,
    ).toBe(false);
    expect(
      validatePayload('presentation.slide.setTransition', {
        deckId: 'deck',
        entryId: 'slide-a',
        transition: { kind: 'fade', durationMs: -1 },
      }).ok,
    ).toBe(false);
    expect(
      preconditionFailure(document, 'presentation.slide.setTransition', {
        deckId: 'deck',
        entryId: 'missing',
        transition: { kind: 'fade', durationMs: 500 },
      }),
    ).toContain('does not exist');
  });

  it('replaces build lists atomically and rejects duplicates and oversized lists', () => {
    let document = docWithFrames(makeFrameNode('frame-a'));
    document = commitPresentationOperation(document, 'presentation.deck.create', {
      id: 'deck',
      name: 'Builds',
      width: 1920,
      height: 1080,
    });
    document = commitPresentationOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: 'slide-a', frameId: 'frame-a', title: 'Opening' },
    });
    document = commitPresentationOperation(document, 'presentation.slide.setBuilds', {
      deckId: 'deck',
      entryId: 'slide-a',
      builds: [
        { id: 'b1', nodeId: 'shape-1', effect: 'flyIn', trigger: 'onClick', durationMs: 400.5 },
        {
          id: 'b2',
          nodeId: 'text-1',
          effect: 'appear',
          trigger: 'afterPrevious',
          paragraphRange: { from: 0, to: 2 },
        },
      ],
    });
    expect(document.presentation?.decks[0]?.slides[0]?.builds).toHaveLength(2);
    document = commitPresentationOperation(document, 'presentation.slide.setBuilds', {
      deckId: 'deck',
      entryId: 'slide-a',
      builds: [],
    });
    expect(document.presentation?.decks[0]?.slides[0]?.builds).toBeUndefined();

    expect(
      validatePayload('presentation.slide.setBuilds', {
        deckId: 'deck',
        entryId: 'slide-a',
        builds: [
          { id: 'b1', nodeId: 'shape-1', effect: 'appear', trigger: 'onClick' },
          { id: 'b1', nodeId: 'shape-2', effect: 'fade', trigger: 'onClick' },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validatePayload('presentation.slide.setBuilds', {
        deckId: 'deck',
        entryId: 'slide-a',
        builds: Array.from({ length: 201 }, (_, index) => ({
          id: `b${index}`,
          nodeId: 'shape-1',
          effect: 'appear',
          trigger: 'onClick',
        })),
      }).ok,
    ).toBe(false);
  });

  it('removes deck references without deleting the frame and preserves unresolved notes', () => {
    let document = docWithFrames(makeFrameNode('frame-a'));
    document = applyOperation(document, 'presentation.deck.create', {
      id: 'deck',
      name: 'Pitch',
      width: 1920,
      height: 1080,
    });
    document = applyOperation(document, 'presentation.slide.add', {
      deckId: 'deck',
      entry: { id: 'slide', frameId: 'frame-a', title: 'Title' },
    });
    document = applyOperation(document, 'presentation.slide.remove', {
      deckId: 'deck',
      entryId: 'slide',
    });
    expect(document.nodes['frame-a']).toBeDefined();
    expect(document.presentation?.decks[0]?.slides).toEqual([]);

    document = {
      ...document,
      presentation: {
        schemaVersion: 1,
        layouts: [],
        themes: [],
        decks: [
          {
            ...document.presentation!.decks[0]!,
            slides: [{ id: 'broken', frameId: 'deleted-frame', title: 'Broken', notes: 'Keep me' }],
          },
        ],
      },
    };
    expect(document.presentation?.decks[0]?.slides[0]?.notes).toBe('Keep me');
  });
});
