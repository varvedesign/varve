/**
 * The proofing walker is the single definition of "which fields of a render
 * item are colours".
 *
 * These tests lock that property down. They exist because the batched proof
 * path needs to know exactly which colours a frame carries, and a second,
 * hand-written traversal would silently drift from the walker as new colour
 * fields are added to the renderer — producing a frame where one field is
 * proofed and another is not.
 */

import type { RenderItem } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { colorSlotsOfItem, mapFrameColors } from './proofing';

/** A render item carrying a colour in every field the renderer can paint. */
function itemWithEveryColourField(): RenderItem {
  return {
    id: 'n1',
    fill: { space: 'rgb', bitDepth: 'uint8', r: 10, g: 20, b: 30, a: 255 },
    fills: [
      { type: 'solid', color: { space: 'rgb', bitDepth: 'uint8', r: 11, g: 21, b: 31, a: 255 } },
      {
        type: 'gradient',
        stops: [
          { offset: 0, color: { space: 'rgb', bitDepth: 'uint8', r: 12, g: 22, b: 32, a: 255 } },
          { offset: 1, color: { space: 'rgb', bitDepth: 'uint8', r: 13, g: 23, b: 33, a: 255 } },
        ],
      },
    ],
    strokes: [
      {
        color: { space: 'rgb', bitDepth: 'uint8', r: 14, g: 24, b: 34, a: 255 },
        width: 1,
      },
    ],
    effects: [
      { type: 'blur', color: { space: 'rgb', bitDepth: 'uint8', r: 15, g: 25, b: 35, a: 255 } },
      {
        type: 'glassMaterial',
        tint: { space: 'rgb', bitDepth: 'uint8', r: 16, g: 26, b: 36, a: 255 },
        edgeHighlightColor: { space: 'rgb', bitDepth: 'uint8', r: 17, g: 27, b: 37, a: 255 },
      },
    ],
    primitive: {
      kind: 'text',
      richText: {
        paragraphs: [
          {
            runs: [
              {
                text: 'hi',
                format: { color: { space: 'rgb', bitDepth: 'uint8', r: 18, g: 28, b: 38, a: 255 } },
              },
              {
                text: 'there',
                format: { color: { space: 'rgb', bitDepth: 'uint8', r: 19, g: 29, b: 39, a: 255 } },
              },
            ],
          },
        ],
      },
    },
  } as unknown as RenderItem;
}

describe('colorSlotsOfItem', () => {
  it('finds every colour-bearing field of a fully populated render item', () => {
    const slots = colorSlotsOfItem(itemWithEveryColourField()) as Array<{ r: number }>;

    // fill, 2 fills (solid + 2 gradient stops), 1 stroke, blur colour,
    // glass tint + edge highlight, 2 rich-text run colours = 10.
    expect(slots).toHaveLength(10);
    // Traversal order is stable and matches the walker.
    expect(slots.map((c) => c.r)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('reports a shared colour object once', () => {
    const shared = { space: 'rgb', bitDepth: 'uint8', r: 1, g: 2, b: 3, a: 255 };
    const item = {
      id: 'shared',
      fill: shared,
      strokes: [
        { color: shared, width: 1 },
        { color: shared, width: 2 },
      ],
    } as unknown as RenderItem;

    expect(colorSlotsOfItem(item)).toHaveLength(1);
  });

  it('reports no slots for an item with no colour fields', () => {
    expect(
      colorSlotsOfItem({ id: 'plain', fill: undefined } as unknown as RenderItem),
    ).toHaveLength(0);
  });
});

describe('mapFrameColors', () => {
  it('keeps array and item identity when nothing changes', () => {
    const item = itemWithEveryColourField();
    const items = [item];

    // A mapper that returns its input unchanged must not allocate.
    const out = mapFrameColors(items, (color) => color);
    expect(out).toBe(items);
    expect(out[0]).toBe(item);
  });

  it('replaces only the fields the mapper changed, preserving identity elsewhere', () => {
    const item = itemWithEveryColourField();
    const items = [item];

    const out = mapFrameColors(items, (color) => {
      const c = color as { r: number };
      // Change exactly one colour, identified by its value.
      return c.r === 14
        ? ({ ...color, r: 99 } as unknown as typeof color)
        : (color as unknown as typeof color);
    });

    expect(out).not.toBe(items);
    const next = out[0] as unknown as { strokes: Array<{ color: { r: number } }>; fill: unknown };
    expect(next.strokes[0]?.color.r).toBe(99);
    // Untouched fields keep their original object identity.
    expect(next.fill).toBe(item.fill);
  });

  it('applies the mapper to every field the collector reported', () => {
    const item = itemWithEveryColourField();
    const seen = new Set<unknown>();
    for (const color of colorSlotsOfItem(item)) seen.add(color);

    let visits = 0;
    mapFrameColors([item], (color) => {
      // Every colour the mapper visits must be one the collector reported, so
      // a batched transform computed from the collector's list can answer it.
      expect(seen.has(color)).toBe(true);
      visits++;
      return color;
    });

    expect(visits).toBe(10);
  });
});
