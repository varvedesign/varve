import { describe, expect, it } from 'vitest';
import { matchesInspectorSectionQuery } from './inspectorSectionSearch';

describe('matchesInspectorSectionQuery', () => {
  it('finds a section by its visible title', () => {
    expect(matchesInspectorSectionQuery('fills', 'Fill', 'fill')).toBe(true);
  });

  it('finds an owning section by a property term', () => {
    expect(matchesInspectorSectionQuery('appearance', 'Appearance', 'opacity')).toBe(true);
    expect(matchesInspectorSectionQuery('position-size', 'Position & Size', 'opacity')).toBe(false);
    expect(matchesInspectorSectionQuery('typography', 'Typography', 'line height')).toBe(true);
  });

  it('accepts abbreviated subsequence queries without producing unrelated matches', () => {
    expect(matchesInspectorSectionQuery('typography', 'Typography', 'typo')).toBe(true);
    expect(matchesInspectorSectionQuery('fills', 'Fill', 'typo')).toBe(false);
  });

  it('requires every word in a multi-word search to match', () => {
    expect(matchesInspectorSectionQuery('effects', 'Layer Effects', 'inner shadow')).toBe(true);
    expect(matchesInspectorSectionQuery('effects', 'Layer Effects', 'inner font')).toBe(false);
  });
});
