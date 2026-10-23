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
 *
 * The current key is `varve-editor-settings`. The legacy
 * `strata-editor-settings` key is honoured the same way `loadSettings` does:
 * it is read only when the current key is absent.
 */
import { InferenceError } from './core/InferenceError';

/** Shared UI copy. Do not use an em dash. */
export const AI_DISABLED_HINT = 'Turn on AI features in Settings to use this';

const SETTINGS_KEY = 'varve-editor-settings';
const LEGACY_SETTINGS_KEY = 'strata-editor-settings';
export const AI_FEATURES_CHANGED_EVENT = 'varve-ai-settings-changed';

let workerSnapshot: boolean | undefined;
let cachedEnabled: boolean | undefined;
let loggedUnreadable = false;
let domListening = false;
const listeners = new Set<() => void>();

function logUnreadable(reason: unknown): void {
  if (loggedUnreadable) return;
  loggedUnreadable = true;
  const detail = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[ai-gate] AI setting unreadable; treating as off. ${detail}`);
}

function invalidateCache(): void {
  cachedEnabled = undefined;
  loggedUnreadable = false;
  for (const listener of listeners) listener();
}

function ensureDomListeners(): void {
  if (domListening || typeof window === 'undefined') return;
  domListening = true;
  const onStoreChange = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key !== null && event.key !== SETTINGS_KEY && event.key !== LEGACY_SETTINGS_KEY) {
        return;
      }
    }
    invalidateCache();
  };
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(AI_FEATURES_CHANGED_EVENT, onStoreChange);
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
  cachedEnabled = undefined;
  loggedUnreadable = false;
}

/** Call after writing editor settings in the same tab so subscribers refresh. */
export function notifyAiFeaturesSettingsChanged(): void {
  invalidateCache();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AI_FEATURES_CHANGED_EVENT));
  }
}

export function subscribeAiFeaturesEnabled(onStoreChange: () => void): () => void {
  ensureDomListeners();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function readEnabledFromStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      logUnreadable('localStorage is unavailable in this context');
      return false;
    }
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
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

export function getAiFeaturesEnabled(): boolean {
  if (workerSnapshot !== undefined) return workerSnapshot;
  ensureDomListeners();
  if (cachedEnabled !== undefined) return cachedEnabled;
  const enabled = readEnabledFromStorage();
  cachedEnabled = enabled;
  return enabled;
}

/**
 * Apply a per-job snapshot from the host, then refuse if AI is off.
 * A missing or non-boolean flag clears any previous snapshot and fails closed
 * without falling back to a cached true snapshot or a main-thread storage read.
 */
export function applyWorkerAiGate(aiEnabled: boolean | undefined): void {
  if (typeof aiEnabled === 'boolean') {
    configureAiFeaturesEnabled(aiEnabled);
    assertAiFeaturesEnabled();
    return;
  }
  workerSnapshot = undefined;
  cachedEnabled = undefined;
  throw new InferenceError('ai_disabled');
}

export function assertAiFeaturesEnabled(): void {
  if (!getAiFeaturesEnabled()) {
    throw new InferenceError('ai_disabled');
  }
}
