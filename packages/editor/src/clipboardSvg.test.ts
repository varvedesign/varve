// @vitest-environment jsdom
import { createDocument, type Document, makeShapeNode, type ShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { buildClipboardSvg, CLIPBOARD_SVG_MAX_NODES } from './clipboardSvg';

function rect(id: string, x: number, y: number, w: number, h: number, transform?: Affine) {
  const node = makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    {
      name: id,
      fill: { space: 'rgb', r: 200, g: 60, b: 40, a: 255 },
      transform: transform ?? ([1, 0, 0, 1, x, y] as Affine),
    },
  );
  return node;
}

function docWith(nodes: ShapeNode[], roots?: string[]): Document {
  const base = createDocument('clipboard-svg', true);
  return {
    ...base,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootChildren: roots ?? nodes.map((node) => node.id),
  };
}

describe('buildClipboardSvg', () => {
  it('serialises the selected roots without a page background', () => {
    const doc = docWith([rect('r1', 10, 20, 30, 40)]);
    const svg = buildClipboardSvg(doc, ['r1']);
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="30"');
    // A clipboard SVG must not carry the opaque page backdrop that the
    // document exporter adds; pasting it would bring a white rectangle.
    expect(svg).not.toContain('fill="#ffffff"');
  });

  it('exports only the requested roots, not their siblings', () => {
    const doc = docWith([rect('r1', 0, 0, 10, 10), rect('r2', 50, 50, 10, 10)]);
    const svg = buildClipboardSvg(doc, ['r2']);
    expect(svg).toBeTruthy();
    // One shape only: the sibling must not be serialised.
    expect((svg!.match(/<rect/g) ?? []).length).toBe(1);
    expect(svg).toContain('width="10"');
    expect(svg).toContain('height="10"');
  });

  it('bakes the world transform so a nested selection keeps its position', () => {
    const parent = {
      ...makeShapeNode(
        'parent',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        {
          transform: [1, 0, 0, 1, 200, 150] as Affine,
        },
      ),
      kind: 'group' as const,
      children: ['child'],
    };
    const child = rect('child', 0, 0, 10, 10);
    const base = createDocument('clipboard-svg', true);
    const doc: Document = {
      ...base,
      nodes: { parent: parent as never, child },
      rootChildren: ['parent'],
    };
    const svg = buildClipboardSvg(doc, ['child']);
    expect(svg).toBeTruthy();
    // The child sits at 200,150 in world space, so the viewBox starts there.
    expect(svg).toMatch(/viewBox="200 150 /);
  });

  it('returns null for an empty selection', () => {
    const doc = docWith([rect('r1', 0, 0, 10, 10)]);
    expect(buildClipboardSvg(doc, [])).toBeNull();
    expect(buildClipboardSvg(doc, ['missing'])).toBeNull();
  });

  it('returns null when the selection exceeds the node budget', () => {
    const nodes: ShapeNode[] = [];
    for (let i = 0; i < CLIPBOARD_SVG_MAX_NODES + 1; i += 1) {
      nodes.push(rect(`n${i}`, i, i, 4, 4));
    }
    const doc = docWith(nodes);
    expect(
      buildClipboardSvg(
        doc,
        nodes.map((node) => node.id),
      ),
    ).toBeNull();
  });

  it('never throws on a malformed node graph', () => {
    const doc = docWith([rect('r1', 0, 0, 10, 10)]);
    const broken = { ...doc, nodes: { r1: undefined } } as unknown as Document;
    expect(() => buildClipboardSvg(broken, ['r1'])).not.toThrow();
    expect(buildClipboardSvg(broken, ['r1'])).toBeNull();
  });
});
