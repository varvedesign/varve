/**
 * Regression: a Varve Library save may only mark the document clean after the
 * library write is confirmed.
 *
 * The library call is the document's only copy for an `app-storage` target.
 * Before this guard the branch reused `mirror()`, which swallows index
 * failures because the Home mirror is secondary for filesystem saves. A failed
 * library write therefore reported "Saved", cleared `dirty`, deleted the
 * recovery point, and let a close/quit discard work that was never stored.
 *
 * External evidence: vectorcraft#1693 (browser save discards write errors,
 * marks clean, can close unsaved documents) and #1685 (save failures silent
 * when the destination is unavailable) — the same ordering defect: success is
 * recorded before the write is confirmed.
 */
import { describe, expect, it, vi } from 'vitest';
import { commitLibrarySave, LIBRARY_SAVE_FAILURE_MESSAGE, librarySaveIssue } from './librarySave';

describe('commitLibrarySave', () => {
  it('commits only after the write is confirmed', async () => {
    const order: string[] = [];
    const issue = await commitLibrarySave({
      write: async () => {
        order.push('write');
      },
      commit: () => {
        order.push('commit');
      },
    });

    expect(issue).toBeNull();
    expect(order).toEqual(['write', 'commit']);
  });

  it('does not commit when the write fails, so the document stays dirty', async () => {
    const commit = vi.fn();
    const issue = await commitLibrarySave({
      write: async () => {
        throw new Error('indexeddb unavailable');
      },
      commit,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(issue).not.toBeNull();
    expect(issue?.message).toContain('still unsaved');
  });

  it('awaits an async commit and propagates its result ordering', async () => {
    const order: string[] = [];
    const issue = await commitLibrarySave({
      write: async () => {
        order.push('write');
        await Promise.resolve();
        order.push('written');
      },
      commit: async () => {
        await Promise.resolve();
        order.push('commit');
      },
    });

    expect(issue).toBeNull();
    expect(order).toEqual(['write', 'written', 'commit']);
  });

  it('names quota exhaustion instead of reporting a generic failure', () => {
    const quota = Object.assign(new Error('no space'), { name: 'QuotaExceededError' });
    expect(librarySaveIssue(quota).category).toBe('quota-exceeded');
    expect(librarySaveIssue(quota).message).toContain('out of space');
  });

  it('falls back to an unknown I/O failure for unrecognised errors', () => {
    expect(librarySaveIssue(new Error('boom'))).toEqual({
      category: 'unknown-io',
      message: LIBRARY_SAVE_FAILURE_MESSAGE,
    });
    expect(librarySaveIssue(undefined).category).toBe('unknown-io');
  });
});
