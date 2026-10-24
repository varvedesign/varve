import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorFocusedEditor } from './InspectorFocusedEditor';

afterEach(cleanup);

/**
 * An owning row whose editor is opened by a real button, plus a control that
 * follows the anchor in DOM order — the destination `yieldTabToAnchor` must
 * reach when the surface is left with Tab.
 */
function Fixture({ onClose }: { onClose: (reason?: string) => void }) {
  const [open, setOpen] = useState(true);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef}>
        Shadow parameters
      </button>
      <button type="button">After anchor</button>
      <InspectorFocusedEditor
        anchorRef={anchorRef}
        open={open}
        title="Shadow parameters"
        ownerKey="row:1"
        onClose={(reason) => {
          setOpen(false);
          onClose(reason);
        }}
      >
        <label>
          Spread
          <input type="range" min={0} max={100} defaultValue={10} />
        </label>
        <button type="button">Apply</button>
      </InspectorFocusedEditor>
    </>
  );
}

/**
 * A host that unmounts its editor on close, the way EffectRow renders it
 * (`{type && expanded && <InspectorFocusedEditor open={expanded} …>}`). Focus
 * restoration must survive the component itself going away, not only an
 * `open` prop transition on a still-mounted instance.
 */
function UnmountingFixture({ onClose }: { onClose: (reason?: string) => void }) {
  const [open, setOpen] = useState(true);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchorRef}>
        Shadow parameters
      </button>
      <button type="button">After anchor</button>
      {open && (
        <InspectorFocusedEditor
          anchorRef={anchorRef}
          open={open}
          title="Shadow parameters"
          ownerKey="row:1"
          onClose={(reason) => {
            setOpen(false);
            onClose(reason);
          }}
        >
          <button type="button">Apply</button>
        </InspectorFocusedEditor>
      )}
    </>
  );
}

describe('InspectorFocusedEditor', () => {
  it('declares a non-modal dialog and moves focus into it on open', async () => {
    render(<Fixture onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Shadow parameters' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');

    await vi.waitFor(
      () => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('lets Tab leave the surface instead of trapping focus inside it', async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Shadow parameters' });
    await vi.waitFor(
      () => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      },
      { timeout: 2000 },
    );

    // "Apply" is the last control: Tab from it must hand focus on rather than
    // cycle back to the close button the way a focus trap would.
    const apply = screen.getByRole('button', { name: 'Apply' });
    apply.focus();
    fireEvent.keyDown(apply, { key: 'Tab' });

    expect(onClose).toHaveBeenCalledWith('tab');
    await vi.waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'After anchor' })).toHaveFocus();
      },
      { timeout: 2000 },
    );
  });

  it('closes on Escape and returns focus to the owning row', async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Shadow parameters' });
    await vi.waitFor(
      () => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      },
      { timeout: 2000 },
    );

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await vi.waitFor(
      () => {
        expect(onClose).toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Shadow parameters' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Shadow parameters' })).toHaveFocus();
      },
      { timeout: 2000 },
    );
  });

  it('closes from the header button and hands focus back to the row', async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    const close = await screen.findByRole('button', { name: 'Close Shadow parameters' });
    await vi.waitFor(
      () => {
        expect(close).toBeVisible();
      },
      { timeout: 2000 },
    );

    fireEvent.click(close);

    await vi.waitFor(
      () => {
        expect(onClose).toHaveBeenCalledWith('action');
        expect(screen.getByRole('button', { name: 'Shadow parameters' })).toHaveFocus();
      },
      { timeout: 2000 },
    );
  });

  it('hands focus back when the host unmounts the editor on close', async () => {
    const onClose = vi.fn();
    render(<UnmountingFixture onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Shadow parameters' });
    await vi.waitFor(
      () => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      },
      { timeout: 2000 },
    );

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await vi.waitFor(
      () => {
        expect(onClose).toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: 'Shadow parameters' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Shadow parameters' })).toHaveFocus();
      },
      { timeout: 2000 },
    );
  });
});
