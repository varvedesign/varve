/**
 * Autosave failure visibility (vectorcraft#1685 class).
 *
 * `AutoSaveService` already reported `'error'`, but nothing consumed the
 * report, so a failing recovery safety net looked exactly like a healthy one.
 * These tests pin the store contract and the status-bar surface.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  getRecoveryStatus,
  resetRecoveryStatusForTests,
  setRecoveryStatus,
  subscribeRecoveryStatus,
} from './recoveryStatus';

describe('recoveryStatus store', () => {
  it('starts healthy and notifies only on change', () => {
    resetRecoveryStatusForTests();
    expect(getRecoveryStatus()).toBe('ok');

    const listener = vi.fn();
    const unsubscribe = subscribeRecoveryStatus(listener);

    setRecoveryStatus('failing');
    expect(getRecoveryStatus()).toBe('failing');
    expect(listener).toHaveBeenCalledTimes(1);

    // Repeating the same status must not re-render subscribers.
    setRecoveryStatus('failing');
    expect(listener).toHaveBeenCalledTimes(1);

    setRecoveryStatus('ok');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setRecoveryStatus('failing');
    expect(listener).toHaveBeenCalledTimes(2);
    resetRecoveryStatusForTests();
  });
});
