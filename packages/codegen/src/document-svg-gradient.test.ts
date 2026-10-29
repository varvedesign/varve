/**
 * The document-level SVG exporter must emit gradient paint servers.
 *
 * `exportDocumentToSvg` collected mask, path-text and pattern definitions but
 * never gradients, and its node emitter filled from `rgba(node.fill)`. A
 * gradient-filled shape therefore exported as one flat colour — an exported
 * document that does not match the canvas. The per-node exporter already did
 * this correctly, so the two export routes disagreed.
 *
 * External evidence: the vectorcraft corpus records repeated "export drops
 * paint" reports (e.g. #3135 for text paint, #2011 colour loss in SVG, #1292
 * for round-trip semantics); the shared mechanism is a route that bypasses the
 * paint-server definitions.
 */
import { addNode, createDocument, type Fill, makeShapeNode, nextNodeId } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportDocumentToSvg } from './index';

function gradientFill(): Fill {
  return {
    type: 'gradient',
    gradient: {
      type: 'linear',
      stops: [
        { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
      ],
    },
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

describe('exportDocumentToSvg gradients', () => {
  it('emits a linearGradient definition and references it from the shape', () => {
    let doc = createDocument('Gradient document');
    const r = nextNodeId(doc);
    const node = makeShapeNode(
      r.id,
      { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
      {
        name: 'GradBox',
      },
    );
    (node as unknown as Record<string, unknown>).fills = [gradientFill()];
    doc = addNode(r.doc, node);

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('<linearGradient');
    expect(svg).toContain(`url(#grad-${r.id}-0)`);
    // The flat-colour fallback must not be what the shape is filled with.
    expect(svg).not.toMatch(/<rect[^>]*fill="rgba\(16,21,31/);
  });

  it('keeps a solid fill as a colour and adds no gradient definition', () => {
    let doc = createDocument('Solid document');
    const r = nextNodeId(doc);
    doc = addNode(
      r.doc,
      makeShapeNode(r.id, { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Solid' }),
    );

    const svg = exportDocumentToSvg(doc);

    expect(svg).not.toContain('<linearGradient');
    expect(svg).not.toContain('<radialGradient');
  });
});
