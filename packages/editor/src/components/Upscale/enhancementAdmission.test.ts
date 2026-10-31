// @vitest-environment jsdom
import { notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getAdmittedEnhancementPresets,
  getEnhancementOperationOptions,
  isAdmittedEnhancementPreset,
  isModelBackedOperation,
  isModelBackedPreset,
  resolveAutoOperationForAiGate,
} from './enhancementAdmission';
import { ENHANCEMENT_PRESETS, getEnhancementPreset } from './enhancementPresets';

describe('enhancement admission when AI is off', () => {
  afterEach(() => {
    localStorage.clear();
    notifyAiFeaturesSettingsChanged();
  });

  it('keeps only Auto and CPU upscale operations', () => {
    const options = getEnhancementOperationOptions(false, () => true);
    expect(options.map((option) => option.value)).toEqual(['auto', 'upscale']);
    expect(options.map((option) => option.label)).not.toEqual(
      expect.arrayContaining(['Denoise', 'Restore + Upscale', 'Deblur', 'Deblur + Upscale']),
    );
  });

  it('keeps the full operation list when AI is on', () => {
    const options = getEnhancementOperationOptions(true, () => true);
    expect(options.map((option) => option.value)).toEqual([
      'auto',
      'upscale',
      'denoise',
      'restore-upscale',
      'deblur',
      'deblur-upscale',
      'compression-restoration',
    ]);
  });

  it('hides model-backed presets and keeps CPU presets', () => {
    expect(getAdmittedEnhancementPresets(false).map((preset) => preset.id)).toEqual([
      'recommended',
      'fast-preview',
      'pixel-art',
    ]);
    expect(isAdmittedEnhancementPreset('photo-cleanup', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('photo-upscale', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('illustration-upscale', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('denoise', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('deblur', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('deblur-upscale', false)).toBe(false);
    expect(isAdmittedEnhancementPreset('recommended', false)).toBe(true);
    expect(isAdmittedEnhancementPreset('fast-preview', false)).toBe(true);
    expect(isAdmittedEnhancementPreset('pixel-art', false)).toBe(true);
  });

  it('keeps every named preset when AI is on', () => {
    expect(getAdmittedEnhancementPresets(true)).toEqual(ENHANCEMENT_PRESETS);
  });

  it('treats denoise, deblur, restore, and AI upscale modes as model-backed', () => {
    expect(isModelBackedOperation('denoise')).toBe(true);
    expect(isModelBackedOperation('restore-upscale')).toBe(true);
    expect(isModelBackedOperation('deblur')).toBe(true);
    expect(isModelBackedOperation('deblur-upscale')).toBe(true);
    expect(isModelBackedOperation('upscale')).toBe(false);
    expect(isModelBackedOperation('auto')).toBe(false);
    expect(isModelBackedPreset(getEnhancementPreset('photo-upscale'))).toBe(true);
    expect(isModelBackedPreset(getEnhancementPreset('photo-cleanup'))).toBe(true);
    expect(isModelBackedPreset(getEnhancementPreset('fast-preview'))).toBe(false);
    expect(isModelBackedPreset(getEnhancementPreset('pixel-art'))).toBe(false);
  });

  it('falls Auto back to CPU upscale or none when the recommendation is model-backed', () => {
    expect(resolveAutoOperationForAiGate('restore-upscale', ['denoise', 'upscale'], false)).toBe(
      'upscale',
    );
    expect(resolveAutoOperationForAiGate('denoise', ['denoise'], false)).toBe(null);
    expect(resolveAutoOperationForAiGate('restore-upscale', ['denoise', 'upscale'], true)).toBe(
      'restore-upscale',
    );
  });
});
