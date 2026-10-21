/**
 * Gesture-transaction coalescing contract.
 *
 * The regression these tests protect: a native range input emits one change
 * event per pointer move, so a control that writes the document from
 * `onChange` without an open transaction pushes one undo entry per move and a
 * single `Ctrl+Z` no longer reverts the gesture.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type GestureTransactionHost, useGestureTransaction } from '../useGestureTransaction';

function makeHost() {
  const calls: string[] = [];
  const host: GestureTransactionHost = {
    beginTransaction: vi.fn(() => calls.push('begin')),
    commitTransaction: vi.fn(() => calls.push('commit')),
    abortTransaction: vi.fn(() => calls.push('abort')),
  };
  return { host, calls };
}

/** Minimal stand-ins for the range input's event surface. */
function pointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    pointerId: 1,
    currentTarget: {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    },
    ...overrides,
  } as unknown as React.PointerEvent<HTMLInputElement>;
}

function keyEvent(key: string) {
  return { key } as React.KeyboardEvent<HTMLInputElement>;
}

describe('useGestureTransaction', () => {
  it('opens exactly one transaction for a multi-move pointer drag', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent()));
    // The document writes that happen between these two calls see an open
    // transaction, so they do not each push an undo entry.
    act(() => result.current.rangeProps.onRangePointerUp(pointerEvent()));

    expect(calls).toEqual(['begin', 'commit']);
    expect(host.beginTransaction).toHaveBeenCalledTimes(1);
    expect(host.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('captures the pointer so a release outside the control still commits', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));
    const down = pointerEvent();

    act(() => result.current.rangeProps.onRangePointerDown(down));

    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('ignores a non-primary button so a context-menu click cannot open a gesture', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent({ button: 2 })));

    expect(host.beginTransaction).not.toHaveBeenCalled();
  });

  it('commits a cancelled pointer instead of reverting a visible change', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent()));
    act(() => result.current.rangeProps.onRangePointerCancel(pointerEvent()));

    expect(calls).toEqual(['begin', 'commit']);
  });

  it('coalesces a keyboard step burst into one transaction', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowRight')));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowRight')));
    act(() => result.current.rangeProps.onRangeKeyUp(keyEvent('ArrowRight')));

    expect(calls).toEqual(['begin', 'commit']);
    expect(host.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('never opens a second transaction for a held key repeat', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowUp')));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowUp')));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowUp')));

    expect(host.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('commits the burst when the key is released on the window, not the input', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('PageUp')));
    // Focus moved away: the input never sees keyup.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageUp' }));
    });

    expect(calls).toEqual(['begin', 'commit']);
  });

  it('commits the burst when the window loses focus mid-burst', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowDown')));
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(calls).toEqual(['begin', 'commit']);
  });

  it('ignores keys a range input does not step on', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('Tab')));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('a')));

    expect(host.beginTransaction).not.toHaveBeenCalled();
  });

  it('aborts on Escape and restores the pre-gesture document', () => {
    const { host, calls } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowRight')));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('Escape')));

    expect(calls).toEqual(['begin', 'abort']);
    expect(host.commitTransaction).not.toHaveBeenCalled();
  });

  it('does not open a transaction while disabled', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host, { enabled: false }));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent()));
    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowRight')));

    expect(host.beginTransaction).not.toHaveBeenCalled();
    expect(result.current.isActive()).toBe(false);
  });

  it('commits rather than stranding an open transaction when the control unmounts', () => {
    const { host, calls } = makeHost();
    const { result, unmount } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent()));
    unmount();

    expect(calls).toEqual(['begin', 'commit']);
  });

  it('leaves no window listener behind after a burst completes', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    act(() => result.current.rangeProps.onRangeKeyDown(keyEvent('ArrowRight')));
    act(() => result.current.rangeProps.onRangeKeyUp(keyEvent('ArrowRight')));

    const added = addSpy.mock.calls.filter(([type]) => type === 'keyup').length;
    const removed = removeSpy.mock.calls.filter(([type]) => type === 'keyup').length;
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('is idempotent: repeated commits push at most one undo entry', () => {
    const { host } = makeHost();
    const { result } = renderHook(() => useGestureTransaction(host));

    act(() => result.current.rangeProps.onRangePointerDown(pointerEvent()));
    act(() => {
      result.current.commit();
      result.current.commit();
      result.current.abort();
    });

    expect(host.commitTransaction).toHaveBeenCalledTimes(1);
    expect(host.abortTransaction).not.toHaveBeenCalled();
  });
});
