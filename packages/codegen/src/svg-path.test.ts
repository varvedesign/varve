import type { Document } from '@varve/scene';
import {
  addChild,
  addNode,
  createCallout,
  createClippingMask,
  createDocument,
  createLiveBooleanDoc,
  defaultStroke,
  makeGroupNode,
  makePathNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentBounds, exportDocumentToSvg } from './index';
import { exportNodeToSvg } from './svg';

describe('SVG path export', () => {
  it('exports a live Boolean as its resolved compound path', () => {
    let doc = createDocument('Live Boolean export', true);
    doc = addNode(doc, makeShapeNode('base', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }));
    doc = addNode(doc, makeShapeNode('cut', { kind: 'rect', x: 25, y: 25, w: 50, h: 50 }));
    const created = createLiveBooleanDoc(doc, ['base', 'cut'], 'subtract');
    expect(created).not.toBeNull();
    if (!created) return;
    doc = created.doc;

    const live = {
      ...doc.nodes[created.nodeId]!,
      transform: [1, 0, 0, 1, 40, 30] as const,
    };
    doc = { ...doc, nodes: { ...doc.nodes, [created.nodeId]: live } };
    const selectedSvg = exportNodeToSvg(live, doc, { background: 'transparent' });
    expect(selectedSvg).toContain('viewBox="40 30 100 100"');
    expect(selectedSvg).toContain('<path');
    expect(selectedSvg).toContain('fill-rule="evenodd"');
    expect(selectedSvg).toContain('M 75 25 L 75 75 L 25 75 L 25 25 Z');
    expect(selectedSvg).not.toContain('<rect x="0" y="0" width="100" height="100"');

    const documentSvg = exportDocumentToSvg(doc);
    // Only the document backdrop remains a rect; the live group's source
    // operands must not leak into a document export.
    expect(documentSvg.match(/<rect /g)?.length).toBe(1);
    expect(documentSvg).toContain('fill-rule="evenodd"');
    expect(documentSvg).toContain('transform="matrix(1,0,0,1,40,30)"');
  });

  it('exports shape path nodes as SVG path data', () => {
    const node = makeShapeNode(
      'p1',
      {
        kind: 'path',
        closed: true,
        tolerance: 1,
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 10, y: 0, handleIn: null, handleOut: null },
          { x: 10, y: 10, handleIn: null, handleOut: null },
          { x: 0, y: 10, handleIn: null, handleOut: null },
        ],
      },
      { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    );
    const doc = {
      ...createDocument('Path export', true),
      rootChildren: ['p1'],
      nodes: { p1: node },
    };

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('<path');
    expect(svg).toContain('d="M 0 0 L 10 0 L 10 10 L 0 10 Z"');
  });

  it('exports compound path holes with evenodd fill-rule', () => {
    const node = makeShapeNode(
      'p1',
      {
        kind: 'path',
        closed: true,
        tolerance: 1,
        fillRule: 'evenodd',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 20, y: 0, handleIn: null, handleOut: null },
          { x: 20, y: 20, handleIn: null, handleOut: null },
          { x: 0, y: 20, handleIn: null, handleOut: null },
        ],
        holes: [
          [
            { x: 5, y: 5, handleIn: null, handleOut: null },
            { x: 15, y: 5, handleIn: null, handleOut: null },
            { x: 15, y: 15, handleIn: null, handleOut: null },
            { x: 5, y: 15, handleIn: null, handleOut: null },
          ],
        ],
      },
      { fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    );
    const doc = {
      ...createDocument('Compound path export', true),
      rootChildren: ['p1'],
      nodes: { p1: node },
    };

    const svg = exportDocumentToSvg(doc);

    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('M 5 5 L 15 5 L 15 15 L 5 15 Z');
  });

  it('sizes a selected trace group SVG to its path children', () => {
    const group = makeGroupNode('g1', { name: 'Trace', transform: [1, 0, 0, 1, 40, 30] });
    const path = makeShapeNode('p1', {
      kind: 'path',
      closed: true,
      tolerance: 1,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 250, y: 0, handleIn: null, handleOut: null },
        { x: 250, y: 10, handleIn: null, handleOut: null },
        { x: 0, y: 10, handleIn: null, handleOut: null },
      ],
    });
    let doc: Document = {
      ...createDocument('Trace export', true),
      rootChildren: ['g1'],
      nodes: { g1: group },
    };
    doc = addChild(doc, 'g1', path);

    const svg = exportNodeToSvg(doc.nodes.g1!, doc);

    expect(svg).toContain('viewBox="40 30 250 10"');

    const documentSvg = exportDocumentToSvg(doc);
    const viewBoxAttribute = 'viewBox="';
    const viewBoxStart = documentSvg.indexOf(viewBoxAttribute);
    const viewBoxEnd = documentSvg.indexOf('"', viewBoxStart + viewBoxAttribute.length);
    const viewBoxParts = documentSvg
      .slice(viewBoxStart + viewBoxAttribute.length, viewBoxEnd)
      .split(' ')
      .map(Number);
    expect(computeDocumentBounds(doc).w).toBeGreaterThanOrEqual(250);
    expect(viewBoxParts[2]).toBeGreaterThanOrEqual(250);
  });

  it('exports a callout tail as SVG path data', () => {
    const created = createCallout(createDocument('Balloon export', true), {
      x: 10,
      y: 20,
      w: 180,
      h: 90,
      text: 'Hello',
      tailEndpoint: { x: 90, y: 140 },
    });
    const svg = exportNodeToSvg(created.document.nodes[created.groupId]!, created.document, {
      background: 'transparent',
    });
    const tail = created.document.nodes[created.tailNodeIds[0]!];
    expect(tail?.kind).toBe('path');
    expect(svg).toContain('<path');
    expect(svg).toContain('d="M ');
    expect(svg).toMatch(/L 90 140|C .* 90 140/);
  });

  it('exports a standalone legacy path node', () => {
    const node = makePathNode('legacy-tail', {
      closed: false,
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 40, y: 80, handleIn: null, handleOut: null },
        { x: 80, y: 0, handleIn: null, handleOut: null },
      ],
    });
    const doc = {
      ...createDocument('Legacy path export', true),
      rootChildren: ['legacy-tail'],
      nodes: { 'legacy-tail': node },
    };
    const svg = exportNodeToSvg(node, doc, { background: 'transparent' });
    expect(svg).toContain('<path');
    expect(svg).toContain('d="M 0 0 L 40 80 L 80 0"');
  });

  it('includes bezier handles and half stroke width in path bounds', () => {
    const node = makePathNode('curve', {
      closed: false,
      strokes: [{ ...defaultStroke(), weight: 20 }],
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [80, 0] },
        { x: 10, y: 0, handleIn: [80, 0], handleOut: null },
      ],
    });
    const doc = {
      ...createDocument('Curved path bounds', true),
      rootChildren: ['curve'],
      nodes: { curve: node },
    };
    const svg = exportNodeToSvg(node, doc, { background: 'transparent' });
    const viewBox = svg
      .match(/viewBox="([^"]+)"/)?.[1]
      ?.split(' ')
      .map(Number);
    expect(viewBox).toBeDefined();
    if (!viewBox) return;
    expect(viewBox[0]).toBeLessThanOrEqual(-10);
    expect(viewBox[2]).toBeGreaterThanOrEqual(100);
  });

  it('exports a closed legacy path clip source as clip-path geometry', () => {
    let doc = createDocument('Path clip export', true);
    doc = addNode(doc, makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 80, h: 60 }));
    doc = addNode(
      doc,
      makePathNode('clip-src', {
        closed: true,
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 80, y: 0, handleIn: null, handleOut: null },
          { x: 80, y: 60, handleIn: null, handleOut: null },
          { x: 0, y: 60, handleIn: null, handleOut: null },
        ],
      }),
    );
    const clipped = createClippingMask(doc, 'clip-src', ['content']);
    const svg = exportNodeToSvg(clipped.doc.nodes[clipped.groupId]!, clipped.doc, {
      background: 'transparent',
    });
    expect(svg).toContain(`<clipPath id="mask-${clipped.groupId}"`);
    expect(svg).toContain(`clip-path="url(#mask-${clipped.groupId})"`);
    expect(svg).toContain('<path d="M 0 0 L 80 0 L 80 60 L 0 60 Z"');
    expect(svg.includes(`clip-path="url(#mask-missing)"`)).toBe(false);
  });
});
