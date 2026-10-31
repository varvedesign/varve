// @vitest-environment jsdom
import { notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { getUpscaleModeOptions } from './upscaleModeOptions';

describe('upscale mode admission', () => {
  afterEach(() => {
    localStorage.clear();
    notifyAiFeaturesSettingsChanged();
  });

  it('keeps the anime model unavailable until provenance and quality gates pass', () => {
    const options = getUpscaleModeOptions(true);
    const anime = options.find((option) => option.value === 'illustration');
    const general = options.find((option) => option.value === 'ai-enhance');

    expect(anime).toMatchObject({
      disabled: true,
      disabledReason: expect.stringMatching(/synthetic browser-WASM smoke/i),
    });
    expect(general).not.toHaveProperty('disabled', true);
  });

  it('keeps non-AI resampling when AI features are off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    notifyAiFeaturesSettingsChanged();
    const options = getUpscaleModeOptions();
    expect(options.map((option) => option.value)).toEqual([
      'pixel-art',
      'fast',
      'balanced',
      'quality',
    ]);
  });
});
