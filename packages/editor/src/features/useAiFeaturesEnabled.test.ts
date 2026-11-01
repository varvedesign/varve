// @vitest-environment jsdom
import { InferenceError, notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAiUserError, resolveBackgroundRemovalMethod } from './useAiFeaturesEnabled';

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

describe('formatAiUserError', () => {
  it('uses InferenceError user copy', () => {
    expect(formatAiUserError(new InferenceError('out_of_memory'), 'fallback')).toMatch(/memory/i);
    expect(formatAiUserError(new InferenceError('ai_disabled'), 'fallback')).toBe(
      'Turn on AI features in Settings to use this',
    );
  });

  it('maps cancel and generic failures without leaking engine text', () => {
    expect(formatAiUserError(new Error('cancelled'), 'fallback')).toMatch(/cancel/i);
    expect(formatAiUserError(new Error('ORT session exploded'), 'Preview failed')).toBe(
      'Preview failed',
    );
    expect(formatAiUserError(new Error('AI features are disabled'), 'fallback')).toBe(
      'Turn on AI features in Settings to use this',
    );
  });
});
