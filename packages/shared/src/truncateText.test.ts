import { describe, expect, it } from 'vitest';
import { splitGraphemeClusters, truncateGraphemes } from './truncateText';

describe('truncateGraphemes', () => {
  it('returns values within budget unchanged', () => {
    expect(truncateGraphemes('Report', 10)).toBe('Report');
    expect(truncateGraphemes('', 5)).toBe('');
  });

  it('keeps the ellipsis inside the budget', () => {
    const out = truncateGraphemes('abcdefghij', 5);
    expect(out).toBe('abcd\u2026');
    expect(splitGraphemeClusters(out)).toHaveLength(5);
  });

  it('never splits a surrogate pair', () => {
    const out = truncateGraphemes('\u{1F3A8}\u{1F3A8}\u{1F3A8}', 2);
    expect(out).toBe('\u{1F3A8}\u2026');
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('keeps a ZWJ sequence whole', () => {
    // Family emoji: five code points, one grapheme cluster.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const out = truncateGraphemes(`${family}${family}${family}`, 2);
    expect(out).toBe(`${family}\u2026`);
  });

  it('keeps a combining mark with its base letter', () => {
    const out = truncateGraphemes('e\u0301e\u0301e\u0301', 2);
    expect(out).toBe('e\u0301\u2026');
  });

  it('truncates CJK by character, not by code unit', () => {
    expect(truncateGraphemes('\u4e2d\u6587\u6587\u4ef6', 3)).toBe('\u4e2d\u6587\u2026');
  });

  it('honours a custom ellipsis and a zero budget', () => {
    expect(truncateGraphemes('abcdef', 4, '...')).toBe('a...');
    expect(truncateGraphemes('abcdef', 0)).toBe('');
  });
});
