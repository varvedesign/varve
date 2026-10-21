/**
 * Central AI master-switch choke point.
 *
 * Every model download and session creation must call
 * {@link assertAiFeaturesEnabled} so a missed UI check cannot still fetch or
 * run an ONNX model. The persisted editor setting is the contract; engine
 * callers cannot import `@varve/editor`.
 */
import { InferenceError } from './core/InferenceError';

const SETTINGS_KEY = 'varve-editor-settings';

export function getAiFeaturesEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ai = parsed.ai as Record<string, unknown> | undefined;
    return ai?.enabled !== false;
  } catch {
    return true;
  }
}

export function assertAiFeaturesEnabled(): void {
  if (!getAiFeaturesEnabled()) {
    throw new InferenceError('ai_disabled');
  }
}
