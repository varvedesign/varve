import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../panelDefinitions';
import { resetPanelRegistry } from '../panelRegistry';
import { panelWidthLimits } from '../panelWidthLimits';

describe('panel width limits', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('reads the declared range from the registry', () => {
    expect(panelWidthLimits('layers')).toEqual({ min: 180, max: 576 });
    expect(panelWidthLimits('inspector')).toEqual({ min: 240, max: 640 });
  });

  it('derives the maximum from twice the preferred size when undeclared', () => {
    // The Resources panel is the case that used to hold its own literal range
    // (240-600) which disagreed with the registry's minimum (220).
    const library = panelWidthLimits('library');
    expect(library?.min).toBe(220);
    expect(library?.max).toBe(600);
    expect(panelWidthLimits('timeline')).toEqual({ min: 320, max: 1440 });
  });

  it('reports null before the registry is populated rather than inventing a range', () => {
    resetPanelRegistry();
    expect(panelWidthLimits('layers')).toBeNull();
  });

  it('never reports a maximum below its minimum', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    for (const id of ['layers', 'inspector', 'library', 'timeline', 'pagenav'] as const) {
      const limits = panelWidthLimits(id);
      expect(limits).not.toBeNull();
      expect(limits!.max).toBeGreaterThanOrEqual(limits!.min);
    }
  });
});
