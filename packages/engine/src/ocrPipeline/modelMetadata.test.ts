import { describe, expect, it } from 'vitest';
import { EN_ONLY_REC_CONFIG, PADDLE_REC_V4_CONFIG } from './modelMetadata';

const COMMIT_SHA = /^https:\/\/raw\.githubusercontent\.com\/PaddlePaddle\/PaddleOCR\/[0-9a-f]{40}\//;
const SHA256 = /^[0-9a-f]{64}$/;

describe('OCR dictionary pinning', () => {
  it('pins the PP-OCRv4 dictionary to an immutable commit URL with a checksum', () => {
    expect(PADDLE_REC_V4_CONFIG.dictionaryUrl).toMatch(COMMIT_SHA);
    expect(PADDLE_REC_V4_CONFIG.dictionaryUrl).not.toMatch(/\/release\/2\.7\//);
    expect(PADDLE_REC_V4_CONFIG.dictionarySha256).toMatch(SHA256);
  });

  it('pins the English-only dictionary the same way', () => {
    expect(EN_ONLY_REC_CONFIG.dictionaryUrl).toMatch(COMMIT_SHA);
    expect(EN_ONLY_REC_CONFIG.dictionarySha256).toMatch(SHA256);
  });
});
