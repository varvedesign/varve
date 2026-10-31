// @vitest-environment jsdom
import { notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBackgroundRemovalMethod } from './useAiFeaturesEnabled';

describe('resolveBackgroundRemovalMethod', () => {
  afterEach(() => {
    localStorage.clear();
    notifyAiFeaturesSettingsChanged();
    vi.unstubAllGlobals();
  });

  it('returns Quick when AI is off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    notifyAiFeaturesSettingsChanged();
    expect(resolveBackgroundRemovalMethod()).toBe('quick');
  });

  it('returns AI Balanced when AI is on', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    expect(resolveBackgroundRemovalMethod()).toBe('ai-balanced');
  });
});
