import { describe, expect, it } from 'vitest';
import { postprocessTrOcr, preprocessTrOcr, TROCR_INPUT_SIZE, validateTrOcrInput } from './trocr';
import { TrOcrTokenizer } from './trocrTokenizer';

const tokenizer = new TrOcrTokenizer({
  model: {
    type: 'BPE',
    vocab: { '<s>': 0, '<pad>': 1, '</s>': 2, Hello: 31414, Ġworld: 232, Ã: 100, '\u00a9': 101 },
  },
  decoder: { type: 'ByteLevel' },
  added_tokens: [
    { id: 0, special: true },
    { id: 1, special: true },
    { id: 2, special: true },
  ],
});

describe('preprocessTrOcr', () => {
  it('returns tensor of correct shape', () => {
    const imageData = new ImageData(100, 50);
    const result = preprocessTrOcr(imageData);
    expect(result.tensor.length).toBe(1 * 3 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE);
    expect(result.originalWidth).toBe(100);
    expect(result.originalHeight).toBe(50);
  });

  it('preserves original dimensions', () => {
    const imageData = new ImageData(640, 480);
    const result = preprocessTrOcr(imageData);
    expect(result.originalWidth).toBe(640);
    expect(result.originalHeight).toBe(480);
  });

  it('handles very small images', () => {
    const imageData = new ImageData(15, 15);
    const result = preprocessTrOcr(imageData);
    expect(result.tensor.length).toBe(3 * TROCR_INPUT_SIZE * TROCR_INPUT_SIZE);
  });

  it('stretches a rectangular crop without adding letterbox pixels and normalizes RGB', () => {
    const pixels = new Uint8ClampedArray(20 * 10 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 128, 255], i);
    const { tensor } = preprocessTrOcr(new ImageData(pixels, 20, 10));
    const area = TROCR_INPUT_SIZE ** 2;
    expect(tensor[0]).toBe(1);
    expect(tensor[area]).toBe(-1);
    expect(tensor[area * 2]).toBeCloseTo(128 / 127.5 - 1);
    expect(tensor[area - 1]).toBe(1);
    expect(tensor[area * 2 - 1]).toBe(-1);
  });

  it('mattes transparent pixels white and rejects malformed images', () => {
    expect(preprocessTrOcr(new ImageData(20, 10)).tensor.every((value) => value === 1)).toBe(true);
    expect(() =>
      preprocessTrOcr({ width: 20, height: 10, data: new Uint8ClampedArray(1) } as ImageData),
    ).toThrow(/pixels/);
  });
});

describe('postprocessTrOcr', () => {
  it('decodes vocabulary ids with ByteLevel spacing and calibrated token probabilities', () => {
    const result = postprocessTrOcr([31414, 232, 2], [0.5, 0.75, 1], tokenizer);
    expect(result.text).toBe('Hello world');
    expect(result.charConfidences).toEqual([...Array(5).fill(0.5), ...Array(6).fill(0.75)]);
    expect(result.confidence).toBeCloseTo(7 / 11);
  });

  it('joins UTF-8 bytes split across tokens before decoding characters', () => {
    expect(postprocessTrOcr([100, 101], [0.8, 0.6], tokenizer)).toEqual({
      text: 'é',
      confidence: 0.6,
      charConfidences: [0.6],
    });
  });

  it('handles immediate EOS and rejects missing tokens and invalid probabilities', () => {
    expect(postprocessTrOcr([2], [1], tokenizer)).toEqual({
      text: '',
      confidence: 0,
      charConfidences: [],
    });
    expect(() => postprocessTrOcr([999], [1], tokenizer)).toThrow(/no token/);
    expect(() => postprocessTrOcr([31414], [Number.NaN], tokenizer)).toThrow(/confidence/);
  });
});

describe('validateTrOcrInput', () => {
  it('rejects null image data', () => {
    const err = validateTrOcrInput({ imageData: null as unknown as ImageData });
    expect(err).not.toBeNull();
  });

  it('rejects images smaller than 10x10', () => {
    const err = validateTrOcrInput({ imageData: new ImageData(5, 5) });
    expect(err).toContain('small');
  });

  it('accepts valid image sizes', () => {
    const err = validateTrOcrInput({ imageData: new ImageData(100, 50) });
    expect(err).toBeNull();
  });
});
