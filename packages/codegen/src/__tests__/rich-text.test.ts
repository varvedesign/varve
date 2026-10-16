/**
 * Rich-text fidelity acceptance: paragraph structure, run styling, blank
 * paragraphs, literal markup, emoji/combining marks, and RTL survive every
 * boundary — the scene model, the IR, and each target emitter.
 */

import type { TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCssModules } from '../css-modules';
import { exportNodeToFlutter } from '../flutter';
import { exportIrToHtml } from '../html';
import { sceneToIR } from '../ir-converter';
import { exportNodeToSwiftUI } from '../swiftui';
import { exportNodeToTailwind } from '../tailwind';
import { buildRichTextDoc } from './helpers/corpus';

/** Corpus builders guarantee their ids; make that contract explicit to tsc. */
function requireNode(doc: ReturnType<typeof buildRichTextDoc>['doc'], id: string): TextNode {
  const node = doc.nodes[id];
  if (!node || node.kind !== 'text') throw new Error(`corpus text node ${id} missing`);
  return node;
}

describe('IR rich-text extraction', () => {
  it('carries full run styles and paragraph boundaries', () => {
    const { doc, textId } = buildRichTextDoc();
    const ir = sceneToIR(doc);
    const body = Object.values(ir.nodes).find(
      (n) => n.metadata.sourceNodeId === textId && n.content.type === 'text',
    );
    expect(body?.content.text?.paragraphs).toBeDefined();
    const paragraphs = body?.content.text?.paragraphs ?? [];
    expect(paragraphs.length).toBe(5);
    // Deliberate blank paragraph survives as an empty run list.
    expect(paragraphs[1]?.runs).toEqual([]);
    // Run color + italic + decoration carry through.
    const headline = paragraphs[0]?.runs ?? [];
    expect(headline[0]?.style.fontWeight).toBe(700);
    expect(headline[2]?.style.fontStyle).toBe('italic');
    expect(headline[2]?.style.color).toMatch(/^#/);
    expect(paragraphs[2]?.runs[1]?.style.decoration).toBe('underline');
    // RTL paragraph keeps direction and alignment.
    expect(paragraphs[4]?.direction).toBe('rtl');
    expect(paragraphs[4]?.textAlign).toBe('right');
  });
});

describe('HTML rich text', () => {
  it('emits paragraphs and spans with exactly-once escaping', () => {
    const { doc, rootId } = buildRichTextDoc();
    const ir = sceneToIR(doc);
    const root = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === rootId);
    if (!root) throw new Error('root missing');
    const { html } = exportIrToHtml(ir, {});
    // Literal markup-like design text stays literal text, escaped once.
    expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    // Paragraph structure is real elements, blank line included.
    expect(html).toContain('<p><br /></p>');
    // Styled spans only where runs differ from the node typography.
    expect(html).toMatch(/<span style="[^"]*font-weight: 700[^"]*">Design<\/span>/);
    expect(html).toMatch(/<span style="[^"]*font-style: italic[^"]*">code<\/span>/);
    // RTL paragraph keeps its direction.
    expect(html).toContain('direction: rtl');
  });
});

describe('Tailwind rich text', () => {
  it('emits paragraph elements and literal run classes', () => {
    const { doc, textId } = buildRichTextDoc();
    const code = exportNodeToTailwind(requireNode(doc, textId), doc);
    expect(code).toMatch(/<p>/);
    expect(code).toContain('<p><br /></p>');
    // Run deltas as literal classes (source-scannable, per the Tailwind
    // source-detection contract).
    expect(code).toContain('{"Design"}');
    expect(code).toMatch(/className="text-\[28px\] font-\[700\]"/);
    expect(code).toMatch(/className="text-\[28px\] font-\[700\] italic text-\[#39d0c6\]"/);
    expect(code).toMatch(/className="text-\[#e85a4f\] underline"/);
    // RTL paragraph uses the dir attribute.
    expect(code).toContain('dir="rtl"');
  });
});

describe('CSS Modules rich text', () => {
  it('emits paragraph elements with run-level inline styles', () => {
    const { doc, textId } = buildRichTextDoc();
    const { jsx } = exportNodeToCssModules(requireNode(doc, textId), doc);
    expect(jsx).toMatch(/<p>/);
    expect(jsx).toContain('<p><br /></p>');
    expect(jsx).toMatch(/<span style=\{\{ fontSize: '28px', fontWeight: '700' \}\}>/);
    expect(jsx).toContain("direction: 'rtl'");
  });
});

describe('Flutter rich text', () => {
  it('emits Text.rich with per-run TextSpans and newline paragraph breaks', () => {
    const { doc, textId } = buildRichTextDoc();
    const code = exportNodeToFlutter(requireNode(doc, textId), doc);
    expect(code).toContain('Text.rich(');
    expect(code).toContain("TextSpan(text: '\\n')");
    expect(code).toMatch(
      /TextSpan\(text: 'Design', style: TextStyle\(\s*fontSize: 28,\s*fontWeight: FontWeight\.w700/,
    );
    expect(code).toContain('fontStyle: FontStyle.italic');
    expect(code).toContain('decoration: TextDecoration.underline');
  });

  it('escapes Dart string delimiters and interpolation exactly once', () => {
    const { doc } = buildRichTextDoc();
    const custom = { ...buildRichTextDoc().doc };
    void custom;
    void doc;
    const text = requireNode(doc, 'headline');
    // Text containing quotes, dollars, and backslashes round-trips.
    const doc2 = { ...doc, nodes: { ...doc.nodes } };
    const hostile: TextNode = {
      ...text,
      id: 'hostile',
      text: "quote ' dollar $ brace { backslash \\",
      richText: undefined,
    };
    doc2.nodes['hostile'] = hostile;
    const code = exportNodeToFlutter(hostile, doc2);
    expect(code).toContain("quote \\' dollar \\$ brace { backslash \\\\");
  });
});

describe('SwiftUI rich text', () => {
  it('concatenates styled Text values with newline parts', () => {
    const { doc, textId } = buildRichTextDoc();
    const code = exportNodeToSwiftUI(requireNode(doc, textId), doc);
    expect(code).toContain('(Text("Design")');
    expect(code).toContain('Text("\\n")');
    expect(code).toContain('.fontWeight(.bold)');
    expect(code).toContain('.italic()');
    expect(code).toContain('.underline()');
    // Base font/color applies to the whole concatenation.
    expect(code).toMatch(/\.font\(\.system\(size: 15\)\)/);
  });

  it('keeps markup-like text literal without forming interpolation', () => {
    const { doc, textId } = buildRichTextDoc();
    const text = requireNode(doc, textId);
    const doc2 = { ...doc, nodes: { ...doc.nodes } };
    const hostile: TextNode = {
      ...text,
      id: 'hostile',
      text: 'inject \\(userId) here',
      richText: undefined,
    };
    doc2.nodes['hostile'] = hostile;
    const code = exportNodeToSwiftUI(hostile, doc2);
    // The backslash is escaped, so no interpolation can form.
    expect(code).toContain('"inject \\\\(userId) here"');
  });
});
