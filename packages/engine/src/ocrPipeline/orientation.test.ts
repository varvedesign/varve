import { describe, expect, it } from 'vitest';
import { mapCoordsThroughRotation } from './orientation';

describe('OCR source-coordinate recovery', () => {
  // Original box [10,20,30,15] in a 100x60 image. These are the bounds
  // produced by Canvas2D's clockwise quarter turns around the translated origin.
  it.each([
    { angle: 0 as const, box: [10, 20, 30, 15] as const },
    { angle: 90 as const, box: [25, 10, 15, 30] as const },
    { angle: 180 as const, box: [60, 25, 30, 15] as const },
    { angle: 270 as const, box: [20, 60, 15, 30] as const },
  ])('maps $angle-degree recognition boxes back to the original image', ({ angle, box }) => {
    expect(mapCoordsThroughRotation(box[0], box[1], box[2], box[3], 100, 60, angle)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 15,
    });
  });
});
