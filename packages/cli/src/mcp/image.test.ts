import { describe, expect, it } from 'vitest';
import { extractImage, IMAGE_PLACEHOLDER } from './image';

const receipt = (output: unknown) =>
  ({ schema: 'varve.receipt/1', outcome: 'applied', summary: 's', output }) as never;

describe('extractImage', () => {
  it('moves pixels out of the JSON copy and keeps everything else', () => {
    const { stripped, image } = extractImage(
      receipt({ width: 3, image: { mimeType: 'image/png', bytes: 4, data: 'QUJDRA==' } }),
    );
    expect(image).toEqual({ mimeType: 'image/png', bytes: 4, data: 'QUJDRA==' });
    const out = (stripped as { output: { width: number; image: { data: string } } }).output;
    expect(out.width).toBe(3);
    expect(out.image.data).toBe(IMAGE_PLACEHOLDER);
    expect(JSON.stringify(stripped)).not.toContain('QUJDRA==');
  });

  it('does not mutate the receipt it was given', () => {
    const original = receipt({ image: { mimeType: 'image/png', bytes: 1, data: 'AAAA' } });
    extractImage(original);
    expect((original as { output: { image: { data: string } } }).output.image.data).toBe('AAAA');
  });

  it('leaves results without an image untouched', () => {
    const plain = receipt({ nodes: [] });
    expect(extractImage(plain)).toEqual({ stripped: plain, image: null });
    expect(extractImage(receipt(undefined)).image).toBeNull();
    expect(extractImage(receipt('text')).image).toBeNull();
  });

  it('refuses anything that is not an image payload', () => {
    for (const image of [
      { mimeType: 'text/html', bytes: 1, data: 'AAAA' },
      { mimeType: 'image/png', bytes: 1, data: 42 },
      { bytes: 1, data: 'AAAA' },
      null,
      'AAAA',
    ]) {
      expect(extractImage(receipt({ image })).image, JSON.stringify(image)).toBeNull();
    }
  });
});
