import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { FirstRunOverlay } from './FirstRunOverlay';
import { FIRST_RUN_OVERLAY_DISMISSED_KEY } from './firstRunOverlayState';

describe('FirstRunOverlay start panel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('offers four starting points, each named with its live key', () => {
    render(<FirstRunOverlay />);
    const list = screen.getByRole('list', { name: 'Starting points', hidden: true });
    const starts = list.querySelectorAll('button');
    expect([...starts].map((b) => b.querySelector('.first-run__start-label')?.textContent)).toEqual(
      ['Draw a frame', 'Draw a shape', 'Add text', 'Find any command'],
    );
    expect([...starts].map((b) => b.querySelector('kbd')?.textContent)).toEqual([
      'F',
      'R',
      'T',
      'Ctrl+/',
    ]);
  });

  it('closes, remembers, then runs the chosen action', () => {
    const dispatch = vi.spyOn(getActionRegistry(), 'dispatch').mockReturnValue(true);
    const onDismiss = vi.fn();
    render(<FirstRunOverlay onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Draw a shape'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(FIRST_RUN_OVERLAY_DISMISSED_KEY)).toBe('true');
    expect(screen.queryByText('Draw a shape')).toBeNull();
    // The action runs after the dialog has closed, so it can take focus.
    expect(dispatch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(dispatch).toHaveBeenCalledWith('toolRect');
  });
});
