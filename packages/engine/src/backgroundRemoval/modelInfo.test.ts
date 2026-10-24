import { describe, expect, it } from 'vitest';
import { AI_QUALITY_MODEL_INFO, getModelInfo } from './modelInfo';

/**
 * Post-inference residency and process RSS cannot establish a model's peak
 * working set or its WASM linear-memory requirement.
 */
describe('background-removal model memory disclosure', () => {
  it('does not present retracted residency as a native peak or browser limit', () => {
    const info = getModelInfo('ai-quality');
    expect(info).toBe(AI_QUALITY_MODEL_INFO);

    expect(info?.estimatedPeakRamBytes).toBeUndefined();
    expect(info?.nativeEstimatedPeakRamBytes).toBeUndefined();
    expect(info?.nativePeakRamDisplay).toBeUndefined();
    expect(info?.peakRamDisplay).toContain('not yet been validated');
    expect(info?.peakRamDisplay).not.toMatch(/450 MB|4\.1 GB|over its limit/);
  });

  it('does not invent a native figure for models that have one working set', () => {
    for (const method of ['quick', 'ai-balanced', 'portrait']) {
      const info = getModelInfo(method);
      expect(info?.nativeEstimatedPeakRamBytes).toBeUndefined();
      expect(info?.nativePeakRamDisplay).toBeUndefined();
    }
  });
});
