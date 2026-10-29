import { describe, expect, it } from 'vitest';
import { escapeXmlText, sanitizeXmlText } from './xmlText';

describe('sanitizeXmlText', () => {
  it('removes invisible noncharacters and keeps a visible mark for undecodable ones', () => {
    expect(sanitizeXmlText('A\u0000B\u0001C\uFFFE\uFFFF\uD800D\uDC00')).toBe('ABC\uFFFDD\uFFFD');
  });

  it('preserves legal whitespace, astral characters and combining marks', () => {
    const legal = 'a\tb\nc\rd \u4e2d\u6587 \u{1F3A8} e\u0301';
    expect(sanitizeXmlText(legal)).toBe(legal);
  });

  it('keeps a valid surrogate pair intact', () => {
    expect(sanitizeXmlText('\u{1F600}')).toBe('\u{1F600}');
  });
});

describe('escapeXmlText', () => {
  it('escapes metacharacters and sanitizes forbidden characters together', () => {
    expect(escapeXmlText('<a & "b"\u0008>')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });

  it('does not escape apostrophes (double-quoted attributes only)', () => {
    expect(escapeXmlText("it's")).toBe("it's");
  });
});
