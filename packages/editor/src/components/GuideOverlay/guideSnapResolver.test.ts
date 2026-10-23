import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../../settings';
import { createGuideSnapResolver } from './guideSnapResolver';

function docWithRect() {
  return addNode(
    createDocument('Guides', true),
    makeShapeNode('rect', { kind: 'rect', x: 135.4, y: 90, w: 100, h: 60 }),
  );
}

describe('createGuideSnapResolver', () => {
  beforeEach(() => {
    updateSettings({ viewport: { snapToObjects: true, snapTolerancePx: 8 } });
  });

  it('snaps to the exact edge and reports the hit', () => {
    const resolve = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'vertical',
      zoom: 1,
      snapEnabled: true,
    });
    expect(resolve).not.toBeNull();
    expect(resolve?.(138)).toEqual({ position: 135.4, snapped: true });
  });

  it('rounds a free position to the established whole-pixel step', () => {
    const resolve = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'vertical',
      zoom: 1,
      snapEnabled: true,
    });
    expect(resolve?.(400.6)).toEqual({ position: 401, snapped: false });
  });

  it('treats an exact hit as snapped instead of rounding it off the geometry', () => {
    const resolve = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'vertical',
      zoom: 1,
      snapEnabled: true,
    });
    expect(resolve?.(135.4)).toEqual({ position: 135.4, snapped: true });
  });

  it('uses the horizontal axis for horizontal guides', () => {
    const resolve = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'horizontal',
      zoom: 1,
      snapEnabled: true,
    });
    expect(resolve?.(92)).toEqual({ position: 90, snapped: true });
  });

  it('returns null when editor snapping is off', () => {
    expect(
      createGuideSnapResolver({
        doc: docWithRect(),
        axis: 'vertical',
        zoom: 1,
        snapEnabled: false,
      }),
    ).toBeNull();
  });

  it('returns null when the object-geometry preference is off', () => {
    updateSettings({ viewport: { snapToObjects: false } });
    expect(
      createGuideSnapResolver({
        doc: docWithRect(),
        axis: 'vertical',
        zoom: 1,
        snapEnabled: true,
      }),
    ).toBeNull();
  });

  it('returns null when the scene has no eligible targets', () => {
    expect(
      createGuideSnapResolver({
        doc: createDocument('Empty', true),
        axis: 'vertical',
        zoom: 1,
        snapEnabled: true,
      }),
    ).toBeNull();
  });

  it('scales the acquisition distance with zoom', () => {
    const near = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'vertical',
      zoom: 4,
      snapEnabled: true,
    });
    const far = createGuideSnapResolver({
      doc: docWithRect(),
      axis: 'vertical',
      zoom: 0.5,
      snapEnabled: true,
    });
    // 6 world px is 24 screen px at 4x (no snap) and 3 screen px at 0.5x.
    expect(near?.(141.4)).toEqual({ position: 141, snapped: false });
    expect(far?.(141.4)).toEqual({ position: 135.4, snapped: true });
  });

  it('honours the active editing surface scope', () => {
    const doc = docWithRect();
    const resolve = createGuideSnapResolver({
      doc,
      axis: 'vertical',
      zoom: 1,
      snapEnabled: true,
      authoredNodeIds: new Set<string>(),
    });
    expect(resolve).toBeNull();
  });
});
