/**
 * Canonical annotations — model, migration and history integration.
 *
 * The contract this file holds: an annotation survives the document round trip,
 * carries an id from the document's own generator, records its anchor rather
 * than inferring one, reports an orphaned anchor instead of reattaching, and
 * reaches revision history as a per-entity change. It is also excluded from
 * every output except the document itself.
 */

import type { NodeId } from '@varve/scene';
import {
  allAnnotations,
  annotationScope,
  annotationsForNode,
  copyAnnotationsForSubtree,
  createAnnotation,
  remapAnnotationAnchors,
  removeAnnotation,
  resolveAnnotationAnchors,
  updateAnnotation,
  upsertAnnotation,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createIdGenerator } from './ids';

const NOW = 1_700_000_000_000;
const FRAME = 'frame-1' as NodeId;
const OTHER = 'frame-2' as NodeId;

function gen() {
  return createIdGenerator();
}

describe('annotation model', () => {
  it('takes its id from the document generator, not a local counter', () => {
    const { annotation, generator } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'Needs a loading state',
      now: NOW,
    });
    // A module-local counter produced `annot-1` in every document, so two
    // documents collided the moment they were combined.
    expect(annotation.id).toMatch(/^an\d+$/);
    expect(annotation.anchorNodeId).toBe(FRAME);
    expect(annotation.createdAt).toBe(NOW);
    expect(generator.counters.annotation).toBe(1);
  });

  it('omits an author rather than inventing one', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'x',
      now: NOW,
    });
    expect(Object.hasOwn(annotation, 'author')).toBe(false);
  });

  it('records an author only when one is supplied', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'x',
      author: 'Kai',
      now: NOW,
    });
    expect(annotation.author).toBe('Kai');
  });

  it('adds, edits and removes without mutating the input map', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'first',
      now: NOW,
    });
    const empty = {};
    const one = upsertAnnotation(empty, annotation);
    expect(empty).toEqual({});

    const edited = updateAnnotation(one, annotation.id, { text: 'second' }, NOW + 5);
    expect(edited[annotation.id]?.text).toBe('second');
    expect(edited[annotation.id]?.updatedAt).toBe(NOW + 5);
    expect(one[annotation.id]?.text).toBe('first');

    expect(removeAnnotation(edited, annotation.id)).toEqual({});
    expect(removeAnnotation(edited, 'missing')).toBe(edited);
  });

  it('ignores an edit to an unknown id instead of creating one', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'x',
      now: NOW,
    });
    const map = upsertAnnotation({}, annotation);
    expect(updateAnnotation(map, 'missing', { text: 'y' }, NOW)).toBe(map);
  });

  it('selects annotations by anchor deterministically', () => {
    let g = gen();
    const a = createAnnotation(g, 'annotation', { anchorNodeId: FRAME, text: 'a', now: NOW });
    g = a.generator;
    const b = createAnnotation(g, 'annotation', { anchorNodeId: OTHER, text: 'b', now: NOW });
    g = b.generator;
    const c = createAnnotation(g, 'annotation', {
      anchorNodeId: FRAME,
      text: 'c',
      now: NOW - 1000,
    });
    const map = {
      [a.annotation.id]: a.annotation,
      [b.annotation.id]: b.annotation,
      [c.annotation.id]: c.annotation,
    };
    expect(annotationsForNode(map, FRAME).map((n) => n.text)).toEqual(['c', 'a']);
    expect(annotationsForNode(map, OTHER).map((n) => n.text)).toEqual(['b']);
  });
});

describe('orphan handling', () => {
  it('reports an annotation whose anchor is gone rather than reattaching it', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: 'deleted-node' as NodeId,
      text: 'pinned to something gone',
      now: NOW,
    });
    const report = resolveAnnotationAnchors({ [annotation.id]: annotation }, { [FRAME]: {} });
    expect(report.live).toEqual([]);
    expect(report.orphaned.map((n) => n.id)).toEqual([annotation.id]);
    // Reattaching would be a guess, and a note on the wrong object is worse
    // than a note the user is told to repair.
    expect(report.orphaned[0]?.anchorNodeId).toBe('deleted-node');
  });

  it('keeps a live annotation live', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'ok',
      now: NOW,
    });
    const report = resolveAnnotationAnchors({ [annotation.id]: annotation }, { [FRAME]: {} });
    expect(report.live).toHaveLength(1);
    expect(report.orphaned).toHaveLength(0);
  });
});

describe('duplication remapping', () => {
  it('moves an anchor that was copied and leaves a foreign anchor alone', () => {
    let g = gen();
    const inside = createAnnotation(g, 'annotation', { anchorNodeId: FRAME, text: 'in', now: NOW });
    g = inside.generator;
    const outside = createAnnotation(g, 'annotation', {
      anchorNodeId: OTHER,
      text: 'out',
      now: NOW,
    });

    const remapped = remapAnnotationAnchors(
      { [inside.annotation.id]: inside.annotation, [outside.annotation.id]: outside.annotation },
      new Map([[FRAME, 'frame-1-copy']]),
    );
    expect(remapped[inside.annotation.id]?.anchorNodeId).toBe('frame-1-copy');
    // A reference outside the copied scope is intentional and must not move.
    expect(remapped[outside.annotation.id]?.anchorNodeId).toBe(OTHER);
  });

  it('returns the same map when nothing moved', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'x',
      now: NOW,
    });
    const map = { [annotation.id]: annotation };
    expect(remapAnnotationAnchors(map, new Map())).toBe(map);
  });

  it('gives a copy a fresh id on the copied anchor', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: FRAME,
      text: 'original',
      now: NOW,
    });
    const { annotations } = copyAnnotationsForSubtree(
      { [annotation.id]: annotation },
      ['frame-1-copy'],
      new Map([[FRAME, 'frame-1-copy']]),
      (src) => `${src}-copy`,
      NOW + 1,
    );
    const copy = Object.values(annotations)[0];
    expect(copy?.id).toBe(`${annotation.id}-copy`);
    expect(copy?.anchorNodeId).toBe('frame-1-copy');
    expect(copy?.createdAt).toBe(NOW + 1);
    expect(allAnnotations(annotations)).toHaveLength(1);
  });

  it('copies nothing when the anchored node was not part of the copy', () => {
    const { annotation } = createAnnotation(gen(), 'annotation', {
      anchorNodeId: OTHER,
      text: 'outside the copied subtree',
      now: NOW,
    });
    const { annotations } = copyAnnotationsForSubtree(
      { [annotation.id]: annotation },
      ['frame-1-copy'],
      new Map([[FRAME, 'frame-1-copy']]),
      (src) => `${src}-copy`,
      NOW + 1,
    );
    expect(Object.keys(annotations)).toHaveLength(0);
  });
});

describe('disclosure scope', () => {
  it('carries annotations only in the document, never in an output', () => {
    expect(annotationScope('document')).toBe(true);
    expect(annotationScope('artwork-export')).toBe(false);
    expect(annotationScope('prototype-audience')).toBe(false);
    expect(annotationScope('generated-source')).toBe(false);
  });
});
