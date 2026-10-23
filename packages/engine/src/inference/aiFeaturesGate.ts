/**
 * Central AI master-switch choke point.
 *
 * Every model download and session creation must call
 * {@link assertAiFeaturesEnabled} so a missed UI check cannot still fetch or
 * run an ONNX model. The persisted editor setting is the contract; engine
 * callers cannot import `@varve/editor`.
 *
 * Product decision (documented here so a later reader does not "fix" it):
 * AI starts on for a fresh install. The approved position is on by default,
 * on-device, and can be turned off in Settings. A missing settings key is
 * therefore treated as on.
 *
 * Fail closed only when the setting cannot be read:
 * - missing key / missing `ai` object: default on
 * - corrupt JSON, thrown storage access, or a worker with no snapshot from
 *   the main thread: treat as off and log it
 *
 * Workers have no `localStorage`. They must receive an explicit snapshot on
 * each job via {@link configureAiFeaturesEnabled}. Until that snapshot is
 * installed, this gate treats the setting as unreadable and refuses.
 */
import { InferenceError } from './core/InferenceError';

/** Shared UI copy. Do not use an em dash. */
export const AI_DISABLED_HINT = 'Turn on AI features in Settings to use this';

const SETTINGS_KEY = 'varve-editor-settings';

let workerSnapshot: boolean | undefined;

function logUnreadable(reason: unknown): void {
  const detail = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[ai-gate] AI setting unreadable; treating as off. ${detail}`);
}

/**
 * Install the main-thread reading so a worker can enforce the same gate.
 * Call this from the worker message handler with the flag the host sent.
 */
export function configureAiFeaturesEnabled(enabled: boolean): void {
  workerSnapshot = enabled;
}

/** Test-only: drop a worker snapshot so the next read goes back to storage. */
export function resetAiFeaturesGateForTests(): void {
  workerSnapshot = undefined;
}

export function getAiFeaturesEnabled(): boolean {
  if (workerSnapshot !== undefined) return workerSnapshot;
  try {
    if (typeof localStorage === 'undefined') {
      logUnreadable('localStorage is unavailable in this context');
      return false;
    }
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return true;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      logUnreadable('settings JSON is not an object');
      return false;
    }
    const ai = (parsed as Record<string, unknown>).ai;
    if (ai === undefined) return true;
    if (ai === null || typeof ai !== 'object') {
      logUnreadable('ai settings are not an object');
      return false;
    }
    return (ai as Record<string, unknown>).enabled !== false;
  } catch (error) {
    logUnreadable(error);
    return false;
  }
}

/**
 * Apply a per-job snapshot from the host, then refuse if AI is off.
 * An omitted flag leaves the worker unreadable (fail closed).
 */
export function applyWorkerAiGate(aiEnabled: boolean | undefined): void {
  if (typeof aiEnabled === 'boolean') {
    configureAiFeaturesEnabled(aiEnabled);
  }
  assertAiFeaturesEnabled();
}

export function assertAiFeaturesEnabled(): void {
  if (!getAiFeaturesEnabled()) {
    throw new InferenceError('ai_disabled');
  }
}
