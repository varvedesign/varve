import { describe, expect, it } from 'vitest';
import { type BrushDab, compositeDabOnNode, makeRasterLayerNode } from '../rasterLayer';

const COLOR = [64, 160, 224, 160] as const;
const DAB: BrushDab = {
  x: 64,
  y: 64,
  radius: 24,
  opacity: 0.5,
  flow: 1,
  hardness: 0,
  angle: 0,
  roundness: 1,
  strokeT: 0,
  strokeDistance: 0,
};

function coloredSoftPixels(overlap: boolean) {
  const empty = makeRasterLayerNode('alpha-fidelity', { width: 128, height: 128 });
  const first = compositeDabOnNode(empty, DAB, COLOR);
  const node = overlap ? compositeDabOnNode(first, { ...DAB, x: 70 }, COLOR) : first;
  const pixels = node.tiles.get('0:0')?.pixels;
  if (!pixels) throw new Error('Expected painted tile');
  const colors: number[][] = [];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    // Ignore values rounded all the way to transparent; inspect the entire
    // soft alpha ramp, not just an opaque centre that hides double premultiply.
    if (pixels[offset + 3]! >= 5 && pixels[offset + 3]! <= 75) {
      colors.push([...pixels.slice(offset, offset + 4)]);
    }
  }
  return colors;
}

describe('soft brush straight-alpha storage (Graphite #3019)', () => {
  it.each([false, true])('keeps RGB constant across a soft edge (overlap=%s)', (overlap) => {
    const pixels = coloredSoftPixels(overlap);
    expect(pixels.length).toBeGreaterThan(100);
    const maxChannelError = Math.max(
      ...pixels.flatMap((pixel) =>
        COLOR.slice(0, 3).map((channel, index) => Math.abs(channel - pixel[index]!)),
      ),
    );
    expect(maxChannelError).toBeLessThanOrEqual(1);
  });
});
