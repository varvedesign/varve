/**
 * Hook to check if AI features are globally enabled.
 *
 * When AI is disabled:
 * - All AI entry points (menus, buttons, shortcuts) are hidden or disabled
 * - Model downloads and loading are blocked
 * - Inference pipelines refuse to run
 * - Background AI tasks (embeddings, etc.) are skipped
 *
 * Existing AI-edited content remains visible and editable, but no new
 * AI operations can be initiated.
 */

import {
  AI_DISABLED_HINT,
  isInferenceError,
  getAiFeaturesEnabled as readPersistedAiFeaturesEnabled,
  subscribeAiFeaturesEnabled,
  toUserMessage,
} from '@varve/engine';
import type { BackgroundRemovalMethod } from '@varve/scene';
import { useSyncExternalStore } from 'react';

export { AI_DISABLED_HINT };

export function useAiFeaturesEnabled(): boolean {
  return useSyncExternalStore(
    subscribeAiFeaturesEnabled,
    readPersistedAiFeaturesEnabled,
    readPersistedAiFeaturesEnabled,
  );
}

/** Map engine / worker failures to the copy the inspector should show. */
export function formatAiUserError(error: unknown, fallback: string): string {
  if (isInferenceError(error)) return error.userMessage;
  if (error instanceof Error && error.message === 'AI features are disabled') {
    return AI_DISABLED_HINT;
  }
  const mapped = toUserMessage(error);
  if (
    mapped === 'Something went wrong. Please try again.' ||
    mapped === 'An unexpected error occurred.'
  ) {
    return fallback;
  }
  return mapped;
}

/**
 * Synchronous check for AI features enabled state.
 * Use this in non-React contexts (menu handlers, IPC, workers).
 * Missing settings stay on. Unreadable settings fail closed.
 */
export function getAiFeaturesEnabled(): boolean {
  return readPersistedAiFeaturesEnabled();
}

/** Control-bar and shortcut routes use AI Balanced only while the setting is on. */
export function resolveBackgroundRemovalMethod(): BackgroundRemovalMethod {
  return getAiFeaturesEnabled() ? 'ai-balanced' : 'quick';
}

/**
 * Check if AI features are enabled and show a toast if not.
 * Returns true if AI features are enabled, false otherwise.
 * Use this at AI entry points to gate access and inform the user.
 */
export function checkAiFeaturesEnabled(
  toastHandler:
    | ((opts: {
        message: string;
        title?: string;
        description?: string;
        type?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'loading';
        duration?: number;
        id?: string;
        dedupeKey?: string;
      }) => void)
    | null
    | undefined,
  featureName?: string,
): boolean {
  if (!getAiFeaturesEnabled()) {
    const message = featureName ? `${featureName}: ${AI_DISABLED_HINT}` : AI_DISABLED_HINT;
    toastHandler?.({ message, type: 'info' });
    return false;
  }
  return true;
}
