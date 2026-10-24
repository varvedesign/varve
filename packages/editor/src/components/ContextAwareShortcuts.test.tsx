import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { notifyAiFeaturesSettingsChanged } from '@varve/engine';
import { makeImageShapeNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../context';
import { ContextAwareShortcuts } from './ContextAwareShortcuts';

vi.mock('../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('@varve/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/ui')>();
  return {
    ...actual,
    Tooltip: ({ children, label }: { children: ReactNode; label?: string }) => (
      <span data-tooltip={label}>{children}</span>
    ),
  };
});

const image = makeImageShapeNode('image-1', {
  name: 'Photo',
  src: 'data:image/png;base64,AA',
});

describe('ContextAwareShortcuts remove-bg', () => {
  afterEach(() => {
    localStorage.clear();
    notifyAiFeaturesSettingsChanged();
    vi.clearAllMocks();
  });

  function mockImageEditor(removeBackground: ReturnType<typeof vi.fn>) {
    vi.mocked(useEditor).mockReturnValue({
      state: {
        selection: [image.id],
        document: { nodes: { [image.id]: image } },
      },
      setTool: vi.fn(),
      groupSelected: vi.fn(),
      ungroupSelected: vi.fn(),
      removeBackground,
      openVectorizeDialog: vi.fn(),
    } as never);
  }

  it('uses Quick and does not mention on-device ML when AI is off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    notifyAiFeaturesSettingsChanged();
    const fetchSpy = vi.fn(() => {
      throw new Error('model fetch must not run while AI is off');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const removeBackground = vi.fn().mockResolvedValue(undefined);
    mockImageEditor(removeBackground);

    render(<ContextAwareShortcuts />);
    const button = screen.getByRole('button', { name: 'Remove background (B)' });
    expect(button).toHaveAttribute('aria-label', 'Remove background (B)');
    fireEvent.click(button);

    expect(removeBackground).toHaveBeenCalledWith('quick');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/on-device ML/i)).toBeNull();
    expect(document.querySelector('[data-tooltip="Remove background (B)"]')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it('uses AI Balanced when AI is on', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    const removeBackground = vi.fn().mockResolvedValue(undefined);
    mockImageEditor(removeBackground);

    render(<ContextAwareShortcuts />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove background (B)' }));
    expect(removeBackground).toHaveBeenCalledWith('ai-balanced');
  });
});
