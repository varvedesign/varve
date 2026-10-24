// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInspectorFocus } from './useInspectorFocus';

function mountDestination(visible = true) {
  const root = document.createElement('section');
  const target = document.createElement('button');
  target.id = 'insp-tab-export';
  target.textContent = 'Export';
  const checkVisibility = vi.fn(() => visible);
  target.checkVisibility = checkVisibility;
  root.append(target);
  const invoker = document.createElement('button');
  invoker.textContent = 'Set Up Export';
  document.body.append(invoker, root);
  invoker.focus();
  const hook = renderHook(() => useInspectorFocus('export'));
  hook.result.current.inspectorRef.current = root;
  return { ...hook, root, target, invoker, checkVisibility };
}

function nextFrame() {
  act(() => vi.advanceTimersToNextFrame());
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('explicit Inspector handoffs', () => {
  it('does not move focus for a background tab request', () => {
    const { result, invoker } = mountDestination();
    act(() => result.current.requestFocus('export'));
    nextFrame();
    expect(invoker).toHaveFocus();
  });

  it('waits for the destination to become visible before focusing it', () => {
    const { result, target, invoker, checkVisibility } = mountDestination(false);
    act(() => result.current.requestFocus('export', true));
    nextFrame();
    expect(invoker).toHaveFocus();
    checkVisibility.mockReturnValue(true);
    nextFrame();
    expect(target).toHaveFocus();
  });

  it('waits for modal dismissal and supports another handoff to the same tab', () => {
    const { result, target, invoker } = mountDestination();
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    act(() => result.current.requestFocus('export', true));
    nextFrame();
    expect(invoker).toHaveFocus();
    dialog.remove();
    nextFrame();
    expect(target).toHaveFocus();
    invoker.focus();
    act(() => result.current.requestFocus('export', true));
    nextFrame();
    expect(target).toHaveFocus();
  });

  it.each(['keydown', 'pointerdown'])('a later %s cancels a delayed focus handoff', (type) => {
    const { result, invoker, checkVisibility } = mountDestination(false);
    act(() => result.current.requestFocus('export', true));
    nextFrame();
    act(() => document.dispatchEvent(new Event(type, { bubbles: true })));
    checkVisibility.mockReturnValue(true);
    nextFrame();
    expect(invoker).toHaveFocus();
  });

  it('a background request supersedes pending deliberate focus', () => {
    const { result, invoker, checkVisibility } = mountDestination(false);
    act(() => result.current.requestFocus('export', true));
    nextFrame();
    act(() => result.current.requestFocus('export'));
    checkVisibility.mockReturnValue(true);
    nextFrame();
    expect(invoker).toHaveFocus();
  });

  it('stops retrying when a destination cannot become visible', () => {
    const { result, invoker, checkVisibility } = mountDestination(false);
    act(() => result.current.requestFocus('export', true));
    act(() => vi.advanceTimersByTime(1_000));
    checkVisibility.mockReturnValue(true);
    nextFrame();
    expect(invoker).toHaveFocus();
  });
});
