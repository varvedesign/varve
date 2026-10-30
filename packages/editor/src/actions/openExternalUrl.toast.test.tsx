import { render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '@varve/ui';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setToastHandler, showEditorToast } from '../context';

/**
 * ToastBridge in Shell.tsx hands `useToast().toast` to `setToastHandler`.
 * This is that same wiring: showEditorToast must render EditorToastOptions.action.
 */
function ToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    setToastHandler(toast);
    return () => setToastHandler(null);
  }, [toast]);
  return null;
}

describe('editor toast action', () => {
  afterEach(() => {
    setToastHandler(null);
  });

  it('renders the Copy button from showEditorToast action', async () => {
    render(
      <ToastProvider>
        <ToastBridge />
      </ToastProvider>,
    );

    showEditorToast({
      title: 'Could not open the link',
      message: 'https://varve.studio/feedback',
      type: 'warning',
      action: {
        label: 'Copy',
        onClick: () => undefined,
      },
    });

    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText('Could not open the link')).toBeTruthy();
    expect(screen.getByText('https://varve.studio/feedback')).toBeTruthy();
  });
});
