/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOnboardingState } from '../onboardingStore';
import { MicroHint } from './MicroHint';
import type { MicroHint as MicroHintData } from './microHintsData';
import { useMicroHints } from './useMicroHints';

const HINT: MicroHintData = {
  id: 'rect.first-use',
  title: 'Rectangle',
  body: 'Click and drag to draw. Hold Shift for a square.',
  category: 'tools',
  duration: 5000,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function HintHarness({ toolId = 'rect', enabled = true }) {
  const { currentHint, dismiss } = useMicroHints({ toolId, enabled, selectionCount: 1 });
  return (
    <>
      {currentHint && <MicroHint hint={currentHint} onDismiss={dismiss} />}
      <button type="button">Next control</button>
    </>
  );
}

describe('MicroHint', () => {
  it('renders title and body', () => {
    render(<MicroHint hint={HINT} onDismiss={vi.fn()} />);
    expect(screen.getByText('Rectangle')).toBeInTheDocument();
    expect(screen.getByText(/Click and drag/)).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn();
    render(<MicroHint hint={HINT} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByLabelText('Dismiss hint'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it('has role=status for screen readers', () => {
    render(<MicroHint hint={HINT} onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('MicroHint lifetime', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('auto-dismisses the composed hint once and remembers it', () => {
    render(<HintHarness />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5200));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(loadOnboardingState().dismissedMicroHints).toContain('rect.first-use');
  });

  it('pauses while the close button has focus, then resumes the remaining time', () => {
    render(<HintHarness />);
    act(() => vi.advanceTimersByTime(2000));
    act(() => screen.getByRole('button', { name: 'Dismiss hint' }).focus());
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('button', { name: 'Dismiss hint' })).toHaveFocus();
    act(() => screen.getByRole('button', { name: 'Next control' }).focus());
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(201));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps zero-duration hints until explicit dismissal', () => {
    const onDismiss = vi.fn();
    render(<MicroHint hint={{ ...HINT, duration: 0 }} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }));
    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not extend the lifetime when its callback changes', () => {
    const first = vi.fn();
    const next = vi.fn();
    const { rerender } = render(<MicroHint hint={HINT} onDismiss={first} />);
    act(() => vi.advanceTimersByTime(4000));
    rerender(<MicroHint hint={HINT} onDismiss={next} />);
    act(() => vi.advanceTimersByTime(1200));
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('cancels pending dismissal when unmounted', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<MicroHint hint={HINT} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(4999));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not let a dismissed hint callback dismiss its replacement', () => {
    const oldDismiss = vi.fn();
    const nextDismiss = vi.fn();
    const { rerender } = render(<MicroHint hint={HINT} onDismiss={oldDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }));
    rerender(<MicroHint hint={{ ...HINT, id: 'pen.first-use' }} onDismiss={nextDismiss} />);
    act(() => vi.advanceTimersByTime(200));
    expect(nextDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(oldDismiss).toHaveBeenCalledTimes(1);
    expect(nextDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not replace a hint while the user is reading it with keyboard focus', () => {
    const { rerender } = render(<HintHarness />);
    act(() => screen.getByRole('button', { name: 'Dismiss hint' }).focus());
    act(() => vi.advanceTimersByTime(31_000));
    rerender(<HintHarness toolId="pen" />);
    expect(screen.getByText('Rectangle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss hint' })).toHaveFocus();
  });

  it('clears a suppressed hint without marking it read or replaying it later', () => {
    const { rerender } = render(<HintHarness />);
    rerender(<HintHarness enabled={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(31_000));
    rerender(<HintHarness />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(loadOnboardingState().dismissedMicroHints).not.toContain('rect.first-use');
  });
});
