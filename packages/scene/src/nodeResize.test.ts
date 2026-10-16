import { describe, expect, it } from 'vitest';
import { makeFrameNode, makeGroupNode, makeShapeNode, makeTextNode } from './document';
import { resizeSceneNode } from './nodeResize';
import type { ShapeNode } from './types';

describe('resizeSceneNode', () => {
  it('sets rect width and height and preserves everything else', () => {
    const node = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 10, h: 20 }, { name: 'Box' });
    const out = resizeSceneNode(node, 40, 50) as ShapeNode;
    expect(out.shape).toEqual({ kind: 'rect', x: 0, y: 0, w: 40, h: 50 });
    expect(out.name).toBe('Box');
    expect(node.shape).toEqual({ kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
  });

  it('keeps an ellipse centered in its new box', () => {
    const node = makeShapeNode('e', { kind: 'ellipse', cx: 5, cy: 5, rx: 5, ry: 5 });
    const out = resizeSceneNode(node, 40, 20) as ShapeNode;
    expect(out.shape).toEqual({ kind: 'ellipse', cx: 20, cy: 10, rx: 20, ry: 10 });
  });

  it('resizes frames and text through w/h', () => {
    const frame = makeFrameNode('f', { w: 10, h: 10 });
    expect(resizeSceneNode(frame, 30, 40)).toMatchObject({ w: 30, h: 40 });
    const text = makeTextNode('t', 'hi', { w: 10, h: 10 });
    expect(resizeSceneNode(text, 30, 40)).toMatchObject({ w: 30, h: 40 });
  });

  it('scales a line about its center', () => {
    const node = makeShapeNode('l', { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 2 });
    const out = resizeSceneNode(node, 20, 1) as ShapeNode;
    const shape = out.shape as unknown as { from: number[]; to: number[] };
    expect(shape.from[0]).toBeCloseTo(-5);
    expect(shape.to[0]).toBeCloseTo(15);
  });

  it('returns the same reference for kinds with no direct size', () => {
    const group = makeGroupNode('g', { children: [] });
    expect(resizeSceneNode(group, 10, 10)).toBe(group);
  });

  it('never lets a polygon collapse below one unit', () => {
    const node = makeShapeNode('p', {
      kind: 'polygon',
      cx: 0,
      cy: 0,
      radius: 10,
      sides: 5,
      rotation: 0,
    });
    const out = resizeSceneNode(node, 0.001, 0.001) as ShapeNode;
    expect((out.shape as { radius: number }).radius).toBe(1);
  });
});
