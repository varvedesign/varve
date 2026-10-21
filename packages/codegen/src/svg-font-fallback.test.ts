/**
 * SVG export must always name a generic font family.
 *
 * A viewer that lacks the design face falls back to its own default — usually
 * a serif — unless the CSS `font-family` list ends in a generic keyword. Varve
 * exported only the design face, so a sans-serif design silently rendered in
 * serif outside the app (vectorcraft#3135). The classification is shared with
 * the email/CSS exporters so one place decides what a family is.
 */
import { createDocument, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvg, svgFontFamilyValue } from './svg';

describe('svgFontFamilyValue', () => {
  it('appends a generic fallback for a sans-serif face', () => {
    expect(svgFontFamilyValue('Source Sans 3')).toBe("'Source Sans 3', sans-serif");
  });

  it('uses the classification, not the default, for a serif face', () => {
    expect(svgFontFamilyValue('Playfair Display')).toBe("'Playfair Display', serif");
    expect(svgFontFamilyValue('Times New Roman')).toBe("'Times New Roman', serif");
  });

  it('maps monospace faces to the monospace generic', () => {
    expect(svgFontFamilyValue('JetBrains Mono')).toBe("'JetBrains Mono', monospace");
  });

  it('does not repeat a family that is already generic', () => {
    expect(svgFontFamilyValue('sans-serif')).toBe('sans-serif');
    expect(svgFontFamilyValue('monospace')).toBe('monospace');
    expect(svgFontFamilyValue('serif')).toBe('serif');
  });

  it('falls back to sans-serif when the family is empty', () => {
    expect(svgFontFamilyValue('   ')).toBe('sans-serif');
  });
});

describe('SVG text export', () => {
  it('writes the generic fallback into an exported text node', () => {
    const doc = createDocument('Font fallback');
    const node = makeTextNode('t1', 'Hello', { name: 'Title', transform: [1, 0, 0, 1, 10, 20] });
    (node as unknown as Record<string, unknown>).fontFamily = 'Source Sans 3';
    (node as unknown as Record<string, unknown>).fontSize = 24;

    const svg = exportNodeToSvg(node, doc);

    // The name is quoted so the list parses in SVG viewers (Chromium treats an
    // unquoted multi-word value as one unmatched family name).
    expect(svg).toContain(`font-family="'Source Sans 3', sans-serif"`);
  });
});

describe('SVG physical size', () => {
  it('writes viewBox and width/height in the same CSS-px user space', async () => {
    // Varve world units are CSS px at 96 dpi (packages/shared/src/units.ts), and
    // SVG's unitless user unit is also 96 dpi CSS px. A 210 mm page therefore
    // exports at 793.7 user units and still measures 210 mm in any conforming
    // viewer — unlike a points-based document written without a unit, which
    // renders at 75 % (vectorcraft#2924/#864). Recorded here so a future change
    // that starts emitting points without a unit fails this test.
    const { physicalToPx } = await import('@varve/shared');
    const width = physicalToPx(210, 'mm');
    const height = physicalToPx(297, 'mm');
    const doc = createDocument('A4');
    const frame = makeShapeNode(
      'page',
      { kind: 'rect', x: 0, y: 0, w: width, h: height },
      { name: 'Page' },
    );
    const svg = exportNodeToSvg(frame, doc);
    const viewBox = svg
      .match(/viewBox="([^"]+)"/)?.[1]
      ?.split(' ')
      .map(Number);
    const w = Number(svg.match(/\swidth="([^"]+)"/)?.[1]);
    const h = Number(svg.match(/\sheight="([^"]+)"/)?.[1]);

    expect(viewBox?.[2]).toBeCloseTo(width, 1);
    expect(w).toBeCloseTo(width, 1);
    expect(h).toBeCloseTo(height, 1);
    // 793.7 px / 96 px-per-inch * 25.4 = 210 mm.
    expect((w / 96) * 25.4).toBeCloseTo(210, 0);
  });
});

describe('SVG text without an explicit family', () => {
  it('still names the engine default family and its generic fallback', () => {
    // The engine renders a node with no fontFamily in DEFAULT_ARTWORK_FONT_FAMILY.
    // Omitting the attribute made the viewer choose its own default instead.
    const doc = createDocument('No family');
    const node = makeTextNode('t2', 'Default', { name: 'Body' });
    const svg = exportNodeToSvg(node, doc);
    expect(svg).toMatch(/font-family="'[^']+', sans-serif"/);
  });
});
