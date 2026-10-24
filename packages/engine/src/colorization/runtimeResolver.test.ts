import { describe, expect, it } from 'vitest';
import { resolveRuntime } from './runtimeResolver';
import type { ImageStats } from './types';

const stats: ImageStats = {
  meanLuminance: 0.5,
  saturationStd: 0,
  fractionNearNeutral: 1,
  fractionLowSaturation: 1,
  edgeDensity: 0.1,
  width: 2048,
  height: 1536,
};

describe('DDColor model intent', () => {
  it.each(['balanced', 'quality'] as const)('%s does not silently use Tiny', (mode) => {
    expect(() => resolveRuntime('photo-colorize', mode, stats, ['ddcolor-tiny'])).toThrow(
      /DDColor.*Settings/,
    );
  });

  it('Fast does not silently load the large model', () => {
    expect(() => resolveRuntime('photo-colorize', 'fast', stats, ['ddcolor'])).toThrow(
      /DDColor Tiny.*Settings/,
    );
  });

  it('Automatic can explicitly resolve the installed variant', () => {
    expect(resolveRuntime('photo-colorize', 'automatic', stats, ['ddcolor-tiny']).modelId).toBe(
      'ddcolor-tiny',
    );
    expect(resolveRuntime('photo-colorize', 'automatic', stats, ['ddcolor']).modelId).toBe(
      'ddcolor',
    );
  });

  it('does not report tiling that the colorization dispatcher does not perform', () => {
    expect(resolveRuntime('photo-colorize', 'quality', stats, ['ddcolor']).tiled).toBe(false);
  });
});
