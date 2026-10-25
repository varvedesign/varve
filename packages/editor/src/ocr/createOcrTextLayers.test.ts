import type { OcrWord } from '@varve/engine';
import { addNode, createDocument, makeImageShapeNode, type TextNode } from '@varve/scene';
import { applyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { createOcrTextLayers } from './createOcrTextLayers';

const word: OcrWord = {
  x: 120,
  y: 60,
  width: 100,
  height: 20,
  text: 'Hello',
  confidence: 0.99,
  detectionConfidence: 0.99,
  charConfidences: [],
};
const source = { width: 400, height: 200 };

describe('OCR placement through image coordinates', () => {
  it('keeps a region when only an interior strip survives the source crop', () => {
    const image = makeImageShapeNode('image', { src: 'fixture', w: 400, h: 200 });
    image.fills![0]!.image!.crop = { x: 145, y: 0, w: 10, h: 200 };
    const result = createOcrTextLayers(
      addNode(createDocument('OCR'), image),
      image.id,
      [word],
      source,
    );
    const text = Object.values(result.document.nodes).find((node) => node.kind === 'text');
    expect(result.created).toBe(1);
    expect(text?.transform).toEqual([1, 0, 0, 1, 120, 60]);
  });

  it('does not turn a tile seam into an enormous reflected text transform', () => {
    const image = makeImageShapeNode('image', { src: 'fixture', w: 800, h: 400 });
    image.fills![0]!.image = { ...image.fills![0]!.image!, fit: 'tile', x: 229.9 };
    const result = createOcrTextLayers(
      addNode(createDocument('OCR'), image),
      image.id,
      [word],
      source,
    );
    const text = Object.values(result.document.nodes).find((node) => node.kind === 'text');
    expect(result.created).toBe(1);
    expect(text?.transform[0]).toBeCloseTo(1);
    expect(text?.transform[3]).toBeCloseTo(1);
  });

  it('finds a visible interior sliver clipped by the image bounds', () => {
    const image = makeImageShapeNode('image', { src: 'fixture', w: 5, h: 5 });
    image.fills![0]!.image = { ...image.fills![0]!.image!, fit: 'crop', x: -145, y: -65 };
    const result = createOcrTextLayers(
      addNode(createDocument('OCR'), image),
      image.id,
      [word],
      source,
    );
    const text = Object.values(result.document.nodes).find((node) => node.kind === 'text');
    expect(result.created).toBe(1);
    expect(text?.transform).toEqual([1, 0, 0, 1, -25, -5]);
  });

  it('preserves image-content rotation and reflection', () => {
    const image = makeImageShapeNode('image', { src: 'fixture', w: 400, h: 200 });
    image.fills![0]!.image = { ...image.fills![0]!.image!, rotation: 180, flipH: true };
    const doc = addNode(createDocument('OCR'), image);
    const result = createOcrTextLayers(doc, image.id, [word], source);
    const text = Object.values(result.document.nodes).find(
      (node) => node.kind === 'text',
    ) as TextNode;
    expect(result.created).toBe(1);
    const origin = applyAffine(text.transform, [0, 0]);
    const corner = applyAffine(text.transform, [text.w!, text.h!]);
    expect(origin[0]).toBeCloseTo(120, 8);
    expect(origin[1]).toBeCloseTo(140, 8);
    expect(corner[0]).toBeCloseTo(220, 8);
    expect(corner[1]).toBeCloseTo(120, 8);
    expect(doc.nodes).not.toHaveProperty(text.id);
  });

  it.each([
    [90, [120, 80], [220, 60]],
    [180, [220, 80], [120, 60]],
    [270, [220, 60], [120, 80]],
  ] as const)(
    'restores a %d-degree recognition correction to the source',
    (angle, origin, corner) => {
      const image = makeImageShapeNode('image', { src: 'fixture', w: 400, h: 200 });
      const doc = addNode(createDocument('OCR'), image);
      const result = createOcrTextLayers(
        doc,
        image.id,
        [{ ...word, orientationCorrected: angle }],
        source,
      );
      const text = Object.values(result.document.nodes).find(
        (node) => node.kind === 'text',
      ) as TextNode;
      expect(applyAffine(text.transform, [0, 0])).toEqual(origin);
      expect(applyAffine(text.transform, [text.w!, text.h!])).toEqual(corner);
      expect(text.text).toBe('Hello');
    },
  );

  it('does not invent layers for empty or wholly cropped-away regions', () => {
    const image = makeImageShapeNode('image', { src: 'fixture', w: 400, h: 200 });
    image.fills![0]!.image!.crop = { x: 300, y: 0, w: 100, h: 200 };
    const doc = addNode(createDocument('OCR'), image);
    expect(createOcrTextLayers(doc, image.id, [word, { ...word, text: ' ' }], source)).toEqual({
      document: doc,
      created: 0,
    });
  });
});
