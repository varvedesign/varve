/**
 * A fallback measurement must not survive the real face becoming usable.
 *
 * OpenPencil #395 reports the canvas drawing every run in the fallback face
 * while exports are correct — the classic stale-text-cache shape: an advance
 * measured before a face loaded is reused afterwards, so the layout keeps the
 * fallback's widths long after the real font is present.
 *
 * Varve keys cached advances by font shorthand plus variation/feature settings
 * and drops the whole cache whenever the usable face set changes. The cache is
 * internal, so what is pinnable is the wiring: every registry revision bump must
 * call `invalidateCanvasTextMeasurements`. Removing that call would silently
 * reintroduce the defect with no other test noticing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidate = vi.fn();

vi.mock('./canvasTextMeasurer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canvasTextMeasurer')>();
  return {
    ...actual,
    invalidateCanvasTextMeasurements: () => {
      invalidate();
      actual.invalidateCanvasTextMeasurements();
    },
  };
});

const { FontRegistry } = await import('./fontRegistry');

beforeEach(() => {
  invalidate.mockClear();
});

describe('text measurement cache invalidation', () => {
  it('drops cached advances when a face is registered', () => {
    const registry = new FontRegistry([]);
    invalidate.mockClear();

    // Registration is what enumeration and restored faces do; a measurement
    // taken before this must not be reused after it.
    registry.register({ family: 'Late Face', weight: 400, style: 'normal', source: 'system' });

    expect(invalidate).toHaveBeenCalled();
  });

  it('drops cached advances when a face is unregistered', () => {
    const registry = new FontRegistry([]);
    registry.register({
      family: 'Removeme',
      weight: 400,
      style: 'normal',
      source: 'system',
      postScriptName: 'Removeme-Regular',
    });
    invalidate.mockClear();

    expect(
      registry.unregisterFace({ family: 'Removeme', postScriptName: 'Removeme-Regular' }),
    ).toBe(true);

    expect(invalidate).toHaveBeenCalled();
  });

  it('advances the registry revision alongside the invalidation', () => {
    const registry = new FontRegistry([]);
    const before = registry.revision;
    registry.register({ family: 'Another Face', weight: 400, style: 'normal', source: 'system' });
    expect(registry.revision).not.toBe(before);
  });
});
