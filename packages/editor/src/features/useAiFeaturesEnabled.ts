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

import { getAiFeaturesEnabled as readPersistedAiFeaturesEnabled } from '@varve/engine';
import { useOptionalSettings } from '../components/Settings/SettingsContext';

export const AI_DISABLED_HINT = 'Turn on AI features in Settings to use this';

export function useAiFeaturesEnabled(): boolean {
  const settings = useOptionalSettings();
  const persisted = readPersistedAiFeaturesEnabled();
  if (settings) return settings.settings.ai.enabled && persisted;
  return persisted;
}

/**
 * Synchronous check for AI features enabled state.
 * Use this in non-React contexts (menu handlers, IPC, workers).
 * Missing settings stay on. Unreadable settings fail closed.
 */
export function getAiFeaturesEnabled(): boolean {
  return readPersistedAiFeaturesEnabled();
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
