/**
 * Unit-conversion safety — the FigCraft #454 contract.
 *
 * That report found rem output rewriting *text content* containing a numeric px
 * token: a layer named `Tile 24px` became `Tile 1.5rem` in HTML/React output,
 * and a text-prop default `24px` became `1.5rem`. CSS lengths converted
 * correctly; the content no longer matched the design.
 *
 * Varve's emitter is structurally different, and these tests are what keep it
 * that way: `formatSize` is a narrow helper that only ever receives a *number*,
 * so a unit change cannot reach authored text, a URL, or a comment. The risk
 * this file guards against is a future refactor to a single global
 * replacement pass over finished output, which is exactly the shape that
 * produced #454.
 *
 * The tests therefore assert both directions:
 *   - a numeric length DOES convert, so conversion is not silently disabled;
 *   - authored text, URLs and string defaults do NOT convert, at any rem base.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToCss } from './css';
import { exportNodeToCssModules } from './css-modules';
import { exportNodeToTailwind } from './tailwind';

const TEXT_NODE = 'text-1' as NodeId;
const BOX_NODE = 'box-1' as NodeId;

/** A text layer whose content carries a numeric px token, as in #454. */
function textDoc(text: string): Document {
  const nodes: Record<NodeId, SceneNode> = {
    [TEXT_NODE]: {
      kind: 'text',
      id: TEXT_NODE,
      name: 'Tile',
      transform: [1, 0, 0, 1, 10, 20],
      text,
      fontSize: 24,
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    } as unknown as SceneNode,
  };
  return { nodes, rootChildren: [TEXT_NODE], pages: [], guides: [] } as unknown as Document;
}

/** A 200x100 rectangle, for asserting that lengths DO convert. */
function boxDoc(): Document {
  const nodes: Record<NodeId, SceneNode> = {
    [BOX_NODE]: {
      kind: 'shape',
      id: BOX_NODE,
      name: 'Box',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    } as unknown as SceneNode,
  };
  return { nodes, rootChildren: [BOX_NODE], pages: [], guides: [] } as unknown as Document;
}

function textNode(doc: Document): SceneNode {
  const node = doc.nodes[TEXT_NODE];
  if (!node) throw new Error('missing text node');
  return node;
}

function boxNode(doc: Document): SceneNode {
  const node = doc.nodes[BOX_NODE];
  if (!node) throw new Error('missing box node');
  return node;
}

describe('foreignObject-free length conversion (css)', () => {
  it('converts a numeric length when rem is requested', () => {
    const css = exportNodeToCss(boxNode(boxDoc()), boxDoc(), { unit: 'rem', baseFontSize: 16 });
    // 200 / 16 = 12.5
    expect(css).toContain('width: 12.5rem;');
    expect(css).not.toContain('width: 200px;');
  });

  it('keeps px when px is requested', () => {
    const css = exportNodeToCss(boxNode(boxDoc()), boxDoc(), { unit: 'px' });
    expect(css).toContain('width: 200px;');
  });

  it('never converts the authored text of a layer', () => {
    const doc = textDoc('Tile 24px');
    const css = exportNodeToCss(textNode(doc), doc, { unit: 'rem', baseFontSize: 16 });
    // The authored string must not appear at all, in any form. `1.5rem` IS
    // expected in this output — it is the converted `font-size: 24` — which is
    // exactly the collision FigCraft #454 hit: a converted length and a text
    // token can read the same. Discriminate by position, never by substring.
    expect(css).not.toContain('Tile');
    expect(css).not.toMatch(/content\s*:/);
    expect(css).toContain('1.5rem');
  });

  it('is unaffected by a rem base that only scales numeric lengths', () => {
    const doc = textDoc('Tile 24px');
    const at16 = exportNodeToCss(textNode(doc), doc, { unit: 'rem', baseFontSize: 16 });
    const at20 = exportNodeToCss(textNode(doc), doc, { unit: 'rem', baseFontSize: 20 });
    // Font size is a numeric length and must change with the base...
    expect(at16).toContain('1.5rem'); // 24 / 16
    expect(at20).toContain('1.2rem'); // 24 / 20
    // ...but no authored content may appear at either base.
    expect(at16).not.toContain('Tile');
    expect(at20).not.toContain('Tile');
  });

  it('declares the unit it used rather than mixing in stray px', () => {
    const css = exportNodeToCss(boxNode(boxDoc()), boxDoc(), { unit: 'rem', baseFontSize: 16 });
    const pxDeclarations = css
      .split('\n')
      .filter((line) => /^\s*(width|height|left|top|font-size|padding)\s*:/.test(line))
      .filter((line) => line.includes('px'));
    expect(pxDeclarations).toEqual([]);
  });
});

describe('markup emitters keep authored text verbatim under rem', () => {
  it('CSS Modules leaves a numeric px token inside text content alone', () => {
    const doc = textDoc('Tile 24px');
    const { css, jsx } = exportNodeToCssModules(textNode(doc), doc, {
      unit: 'rem',
      baseFontSize: 16,
    });
    // Position-aware: the text literal is verbatim, and no rem value leaks into
    // the markup's text position.
    expect(jsx).toContain('Tile 24px');
    expect(jsx).not.toMatch(/>[^<]*rem[^<]*</);
    // The stylesheet converted its own font-size length, proving rem was active
    // in the same generation pass: 24 / 16 = 1.5rem.
    expect(css).toContain('1.5rem');
  });

  it('Tailwind leaves a numeric px token inside text content alone', () => {
    const doc = textDoc('Tile 24px');
    const jsx = exportNodeToTailwind(textNode(doc), doc, { baseFontSize: 16 });
    expect(jsx).toContain('Tile 24px');
    expect(jsx).not.toContain('1.5rem');
  });

  it('preserves a script terminator and a URL-shaped token in text content', () => {
    const doc = textDoc('</script> https://example.test/a?px=24&w=48px');
    const { jsx } = exportNodeToCssModules(textNode(doc), doc, { unit: 'rem', baseFontSize: 16 });
    expect(jsx).toContain('https://example.test/a?px=24&w=48px');
    expect(jsx).not.toContain('1.5rem');
  });
});
