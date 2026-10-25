/** Deterministic OCR crop resize: opaque white matte, half-pixel bilinear RGB,
 * NCHW, rescale 1/255 and mean/std 0.5. Shared by PaddleOCR and TrOCR so native
 * and browser paths read the same pixels without relying on a canvas shim. */
export function ocrImageTensor(
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const { width, height, data } = image;
  if (
    ![width, height, targetWidth, targetHeight].every(
      (size) => Number.isInteger(size) && size >= 1 && size <= 4096,
    ) ||
    data.length !== width * height * 4
  )
    throw new Error('Invalid OCR image dimensions or pixels');

  const plane = targetWidth * targetHeight;
  const tensor = new Float32Array(3 * plane);
  const sample = (x: number, y: number, channel: number) => {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3]! / 255;
    return data[index + channel]! * alpha + 255 * (1 - alpha);
  };
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.max(0, ((y + 0.5) * height) / targetHeight - 0.5);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.max(0, ((x + 0.5) * width) / targetWidth - 0.5);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sourceX - x0;
      for (let channel = 0; channel < 3; channel++) {
        const top = sample(x0, y0, channel) * (1 - fx) + sample(x1, y0, channel) * fx;
        const bottom = sample(x0, y1, channel) * (1 - fx) + sample(x1, y1, channel) * fx;
        tensor[channel * plane + y * targetWidth + x] = (top * (1 - fy) + bottom * fy) / 127.5 - 1;
      }
    }
  }
  return tensor;
}
