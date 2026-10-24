/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfoHint } from './InfoHint';

// Same harness as Popover.test.tsx: jsdom lacks the popover UA styles, so the
// registry-backed path is exercised, and positioning resolves immediately.
vi.hoisted(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete proto.showPopover;
  delete proto.hidePopover;
  delete proto.togglePopover;
});
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 0, y: 0, middlewareData: { arrow: { x: 4, y: 4 } } }),
  ),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  hide: vi.fn(),
  size: vi.fn(),
  arrow: vi.fn(),
}));
afterEach(cleanup);

describe('InfoHint', () => {
  it('keeps its explanation out of the resting layout and names the trigger by topic', () => {
    render(<InfoHint topic="snap tolerance">Measured in CSS pixels.</InfoHint>);
    const trigger = screen.getByRole('button', { name: 'About snap tolerance' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('dialog', { name: 'About snap tolerance' })).toBeNull();
  });

  it('opens on activation and closes on Escape', async () => {
    render(<InfoHint topic="snap tolerance">Measured in CSS pixels.</InfoHint>);
    const trigger = screen.getByRole('button', { name: 'About snap tolerance' });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = await waitFor(() => screen.getByRole('dialog', { name: 'About snap tolerance' }));
    expect(panel).toHaveTextContent('Measured in CSS pixels.');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });
});
