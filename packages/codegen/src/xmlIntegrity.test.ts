/**
 * @vitest-environment jsdom
 *
 * Exported SVG must be well-formed XML even when the document contains
 * characters XML 1.0 forbids.
 *
 * Evidence: storytold/lightcraft#2131 — "XMP writer emits characters XML 1.0
 * forbids (U+0000–U+001F, U+FFFE), so other tools reject the whole sidecar."
 * The same class reaches Varve's SVG export: pasted text can legitimately
 * contain control characters (clipboard HTML, PDF extraction, imported files),
 * and `escapeXml` only escaped `& < > "`. One C0 byte makes the whole exported
 * SVG unparseable, which is an output-integrity failure rather than a cosmetic
 * one: the file looks exported but no XML consumer will open it.
 *
 * XML 1.0 (Fifth Edition) §2.2 `Char` production:
 *   #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 * Everything outside that set — including lone UTF-16 surrogates — cannot be
 * represented in an XML document at all, not even escaped.
 */
import type { Document as SceneDoc } from '@varve/scene';
import { createDocument, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvg } from './svg';

/**
 * Independent predicate for the XML 1.0 `Char` production. Deliberately not
 * imported from the implementation: a regression in the sanitizer must show up
 * as a test failure, not as agreement with itself.
 */
function illegalXmlCharacters(source: string): string[] {
  const illegal: string[] = [];
  for (const character of source) {
    const code = character.codePointAt(0) as number;
    const legal =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!legal) illegal.push(character);
  }
  return illegal;
}

function expectWellFormedXml(source: string, label: string): void {
  expect(illegalXmlCharacters(source), `${label} must not carry XML-illegal characters`).toEqual(
    [],
  );
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  expect(
    parsed.querySelector('parsererror')?.textContent ?? null,
    `${label} must parse as XML`,
  ).toBeNull();
}

describe('exported SVG text integrity', () => {
  it('drops XML-illegal characters instead of emitting an unparseable file', () => {
    const doc: SceneDoc = createDocument('XML integrity');
    // A pasted control character, a noncharacter, and a lone high surrogate
    // (what a naive UTF-16 slice leaves behind).
    const node = makeTextNode('t1', 'A\u0001B\uFFFE\uD800C', {
      name: 'Caption',
      w: 240,
      h: 48,
      fontSize: 16,
      fontFamily: 'Inter',
      fontWeight: 400,
      textAlign: 'left',
    });
    const svg = exportNodeToSvg(node, doc);
    expectWellFormedXml(svg, 'SVG export');
    // U+0001 and U+FFFE are removed (they never had a visual form); the lone
    // surrogate becomes U+FFFD because it stands for an undecodable character.
    expect(svg).toContain('AB\uFFFDC');
  });

  it('keeps legal whitespace, emoji and CJK text intact', () => {
    const doc: SceneDoc = createDocument('Legal text');
    const node = makeTextNode('t2', 'A\tB\nC \u4e2d\u6587 \u{1F3A8}', {
      name: 'Caption',
      w: 320,
      h: 48,
      fontSize: 16,
      fontFamily: 'Inter',
      fontWeight: 400,
      textAlign: 'left',
    });
    const svg = exportNodeToSvg(node, doc);
    expectWellFormedXml(svg, 'SVG export');
    expect(svg).toContain('\u4e2d\u6587');
  });
});
