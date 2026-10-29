import type { Color } from '@varve/engine';
import { type ManagedColor, rgbFromTuple } from '@varve/scene';
import { denormalizeChannel, managedColorToRgba, normalizeChannel } from '@varve/shared';

export function colorToManaged(c: Color): ManagedColor {
  return rgbFromTuple(c);
}
export function managedToColor(c: ManagedColor): Color {
  // Engine adjustment colors are 0-255 tuples: normalize at the color's own
  // bit depth first, so a uint16/float color cannot corrupt the parameter
  // scale (a raw 32768 channel would be misread as byte 32768).
  if (c.space === 'rgb') {
    const bd = c.bitDepth ?? 'uint8';
    return [
      denormalizeChannel(normalizeChannel(c.r, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.g, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.b, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.a, bd), 'uint8'),
    ] as Color;
  }
  const [r, g, b, a] = managedColorToRgba(c as Parameters<typeof managedColorToRgba>[0]);
  return [r, g, b, a] as Color;
}
