/**
 * Measured SVG text acceptance: with a font-metrics provider, the SVG's
 * line breaks and run placement come from the engine's own layout (parity),
 * alignment offsets are applied from measured widths, and the absence of
 * metrics is disclosed instead of silently approximated.
 */

// @vitest-environment node
import { buildTextLayoutSnapshot, shapeText } from '@varve/engine';
import type { TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvg } from '../svg';
import { layoutSvgText } from '../svgTextLayout';
import { buildRichTextDoc, buildWrappedTextDoc } from './helpers/corpus';

/** Deterministic metrics: every character measures exactly 10px. */
const mockMeasurer = {
  measureText: (text: string) => ({
    width: text.length * 10,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 10,
    fontBoundingBoxAscent: 10,
    fontBoundingBoxDescent: 3,
  }),
  font: '',
} as unknown as CanvasRenderingContext2D;

describe('measured SVG text', () => {
  it('wraps area text exactly as the engine layout does (parity)', () => {
    const { doc, textId } = buildWrappedTextDoc();
    const node = doc.nodes[textId] as TextNode;
    if (!node) throw new Error('corpus text node missing');

    // The authority: the engine's own layout at the same width.
    const shaping = shapeText(
      node.text,
      node.fontFamily ?? 'Inter',
      node.fontSize ?? 16,
      mockMeasurer,
      {
        fontWeight: node.fontWeight,
        letterSpacing: node.letterSpacing,
      },
    );
    const snapshot = buildTextLayoutSnapshot(node.text, shaping, {
      maxWidth: node.w ?? 280,
      lineHeight: (node.lineHeight ?? 1.2) * (node.fontSize ?? 16),
    });

    const measured = layoutSvgText(node, mockMeasurer);
    expect(measured).not.toBeNull();
    expect(measured?.lines.length).toBe(snapshot.lines.length);
    expect(measured?.lines.length).toBeGreaterThan(1);
    for (let i = 0; i < snapshot.lines.length; i += 1) {
      const engineLine = snapshot.lines[i];
      const svgLine = measured?.lines[i];
      expect(svgLine?.baseline).toBeCloseTo(engineLine?.baseline ?? 0, 2);
      expect(svgLine?.width).toBeCloseTo(engineLine?.width ?? 0, 2);
    }
  });

  it('emits measured line tspans whose breaks match the engine layout', () => {
    const { doc, textId } = buildWrappedTextDoc();
    const node = doc.nodes[textId] as TextNode;
    if (!node) throw new Error('corpus text node missing');
    const shaping = shapeText(
      node.text,
      node.fontFamily ?? 'Inter',
      node.fontSize ?? 16,
      mockMeasurer,
    );
    const snapshot = buildTextLayoutSnapshot(node.text, shaping, {
      maxWidth: node.w ?? 280,
      lineHeight: (node.lineHeight ?? 1.2) * (node.fontSize ?? 16),
    });
    const engineLineTexts = snapshot.lines.map((line) =>
      node.text.slice(line.sourceStart, line.sourceEnd),
    );

    const svg = exportNodeToSvg(doc.nodes['root']!, doc, { measure: mockMeasurer });
    // Every engine line's text appears verbatim as an emitted tspan
    // (trailing wrap spaces included — the slice is the layout's own).
    for (const lineText of engineLineTexts) {
      expect(svg).toContain(`>${lineText}<`);
    }
    // No metrics disclosure when a measurer is supplied.
    expect(svg).not.toContain('without font metrics');
  });

  it('applies alignment offsets from measured line widths', () => {
    const { doc, textId } = buildWrappedTextDoc();
    const node = doc.nodes[textId] as TextNode;
    if (!node) throw new Error('corpus text node missing');
    const centered: TextNode = { ...node, textAlign: 'center' };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [textId]: centered } };
    const svg = exportNodeToSvg(doc2.nodes['root']!, doc2, { measure: mockMeasurer });
    // A centered line sits at (boxWidth - lineWidth) / 2, not at 0.
    const measured = layoutSvgText(centered, mockMeasurer);
    const first = measured?.lines[0];
    expect(first).toBeDefined();
    const expectedX = ((node.w ?? 280) - (first?.width ?? 0)) / 2 + (first?.runs[0]?.x ?? 0);
    expect(svg).toContain(`x="${expectedX.toFixed(2)}"`);
  });

  it('keeps rich runs styled and positioned from measured geometry', () => {
    const { doc, textId } = buildRichTextDoc();
    const node = doc.nodes[textId] as TextNode;
    if (!node) throw new Error('corpus text node missing');
    const measured = layoutSvgText(node, mockMeasurer);
    expect(measured).not.toBeNull();
    const svg = exportNodeToSvg(doc.nodes['root']!, doc, { measure: mockMeasurer });
    // Per-run formatting survives measured placement.
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('fill="rgba(57,208,198');
    // RTL paragraph keeps its direction.
    expect(svg).toContain('direction="rtl"');
  });

  it('discloses the absence of metrics instead of silently guessing', () => {
    const { doc, rootId } = buildWrappedTextDoc();
    const svg = exportNodeToSvg(doc.nodes[rootId]!, doc);
    expect(svg).toContain('area text exported without font metrics');
  });

  it('discloses overset content past the authored box', () => {
    const { doc, textId } = buildWrappedTextDoc();
    const node = doc.nodes[textId] as TextNode;
    if (!node) throw new Error('corpus text node missing');
    const cramped: TextNode = { ...node, h: 20 };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [textId]: cramped } };
    const svg = exportNodeToSvg(doc2.nodes['root']!, doc2, { measure: mockMeasurer });
    expect(svg).toContain('text overset');
  });
});
