/**
 * Pending-edit registry contract.
 *
 * Evidence: storytold/pdfcraft #811 and #166 — a save/close taken while an
 * editing surface still holds buffered input persists a document that is
 * missing what the user can see. These tests pin the registry mechanics; the
 * overlay registration and the save/termination drain are pinned in
 * `TextEditOverlay.test.tsx`, `lifecycle/__tests__/coordinator.test.ts`, and
 * the end-to-end save spec.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushPendingEdits,
  hasPendingEdits,
  pendingEditSourceIds,
  registerPendingEditSource,
  resetPendingEditSources,
} from './pendingEdits';

afterEach(() => {
  resetPendingEditSources();
});

/** A source with a manually controlled pending flag. */
function source(id: string, flush: () => void = () => {}) {
  const state = { pending: true };
  const entry = {
    id,
    hasPending: () => state.pending,
    flush,
  };
  return { state, entry };
}

describe('pending edit sources', () => {
  it('reports nothing pending when no surface is buffering', () => {
    expect(hasPendingEdits()).toBe(false);
    expect(flushPendingEdits()).toBe(0);
  });

  it('flushes a registered source that holds work and reports the count', () => {
    const flush = vi.fn();
    registerPendingEditSource(source('editor', flush).entry);
    expect(hasPendingEdits()).toBe(true);
    expect(flushPendingEdits()).toBe(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('skips a registered source that holds nothing', () => {
    const flush = vi.fn();
    const { state, entry } = source('editor', flush);
    state.pending = false;
    registerPendingEditSource(entry);
    expect(hasPendingEdits()).toBe(false);
    expect(flushPendingEdits()).toBe(0);
    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes every buffering surface in one drain', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerPendingEditSource(source('editor', first).entry);
    registerPendingEditSource(source('inspector', second).entry);
    expect(flushPendingEdits()).toBe(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unregisters a source when its surface stops buffering', () => {
    const flush = vi.fn();
    const unregister = registerPendingEditSource(source('editor', flush).entry);
    unregister();
    expect(pendingEditSourceIds()).toEqual([]);
    expect(flushPendingEdits()).toBe(0);
    expect(flush).not.toHaveBeenCalled();
  });

  it('lets a surface replace its own entry instead of accumulating', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerPendingEditSource(source('editor', first).entry);
    registerPendingEditSource(source('editor', second).entry);
    expect(pendingEditSourceIds()).toEqual(['editor']);
    expect(flushPendingEdits()).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale cleanup clear a newer registration', () => {
    // A remount can install the next registration before the previous cleanup
    // runs. Dropping the newer entry would silently re-open the loss window.
    const flush = vi.fn();
    const stale = registerPendingEditSource(source('editor', vi.fn()).entry);
    registerPendingEditSource(source('editor', flush).entry);
    stale();
    expect(pendingEditSourceIds()).toEqual(['editor']);
    expect(flushPendingEdits()).toBe(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('re-checks each source inside the drain', () => {
    // Both surfaces read the same document, so an earlier flush can settle a
    // later one; a settled source must not be flushed again.
    const later = source('later', vi.fn());
    registerPendingEditSource({
      id: 'first',
      hasPending: () => true,
      flush: () => {
        later.state.pending = false;
      },
    });
    registerPendingEditSource(later.entry);
    expect(flushPendingEdits()).toBe(2);
    expect(later.entry.flush).not.toHaveBeenCalled();
  });
});
