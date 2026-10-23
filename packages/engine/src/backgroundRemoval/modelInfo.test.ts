import { describe, expect, it } from 'vitest';
import { getModelById } from '../inference/modelCatalog';
import { AI_QUALITY_MODEL_INFO, getModelInfo } from './modelInfo';

/**
 * The desktop app and the browser have different working sets for the same
 * model, and the app used to show (and gate on) the browser number everywhere.
 * High quality was advertised as "~7 GB RAM" and refused natively on hosts with
 * gigabytes free, while the measured native peak is 432 MiB.
 */
describe('background-removal model memory disclosure', () => {
  it('keeps the measured native peak separate from the browser working set', () => {
    const info = getModelInfo('ai-quality');
    expect(info).toBe(AI_QUALITY_MODEL_INFO);

    // Browser figure: conservative, unchanged, and labelled as browser-scoped.
    expect(info?.estimatedPeakRamBytes).toBe(6_800_000_000);
    expect(info?.peakRamDisplay).toContain('browser');

    // Native figure: the measured value the preflight actually admits against.
    expect(info?.nativeEstimatedPeakRamBytes).toBe(450_000_000);
    expect(info?.nativePeakRamDisplay).toContain('desktop');
    expect(info?.nativePeakRamDisplay).not.toContain('7 GB');
  });

  it('agrees with the catalog entry the native preflight reads', () => {
    const entry = getModelById('birefnet-general-lite');
    expect(entry?.nativePeakMemoryBytes).toBe(450_000_000);
    // The browser admission path keeps the declared figure.
    expect(entry?.peakMemoryBytes).toBe(7_000_000_000);
  });

  it('does not invent a native figure for models that have one working set', () => {
    for (const method of ['quick', 'ai-balanced', 'portrait']) {
      const info = getModelInfo(method);
      expect(info?.nativeEstimatedPeakRamBytes).toBeUndefined();
      expect(info?.nativePeakRamDisplay).toBeUndefined();
    }
  });
});
