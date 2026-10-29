/**
 * Whether crash-recovery autosave can currently write.
 *
 * Autosave never marks a document clean, so a failure here does not break the
 * authoritative save contract — but it does remove the user's safety net.
 * `AutoSaveService` already reports `'error'` through `onStateChange`, and that
 * callback had no production consumer: a user whose recovery writes keep
 * failing (storage quota, revoked permission, disabled storage) was told
 * nothing while believing their work was protected. The same complaint about
 * background saves is recorded as vectorcraft#1685.
 *
 * The status lives in a module-level store rather than `EditorState` because
 * the status bar is its only consumer; adding a context field would touch the
 * editor's largest type and its import budget for one readout.
 */
export type RecoveryStatus = 'ok' | 'failing';

let status: RecoveryStatus = 'ok';
const listeners = new Set<() => void>();

export function getRecoveryStatus(): RecoveryStatus {
  return status;
}

export function setRecoveryStatus(next: RecoveryStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

export function subscribeRecoveryStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Production clears the status through the autosave service
 *  reporting a successful cycle, or through provider teardown. */
export function resetRecoveryStatusForTests(): void {
  status = 'ok';
  listeners.clear();
}
