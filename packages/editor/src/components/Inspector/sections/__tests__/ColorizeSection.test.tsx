// @ts-nocheck
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const models = vi.hoisted(() => ({
  available: vi.fn(),
  ready: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../../controls/FieldRow', () => ({
  FieldRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div data-testid="field-row" data-label={label}>
      {children}
    </div>
  ),
}));

vi.mock('../../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="disclosure-section" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../../../../context', () => ({
  useEditor: () => ({
    state: { document: { nodes: {} }, sectionVisibility: {}, selection: [] },
    selectedNodes: () => [],
    announce: vi.fn(),
    updateDoc: vi.fn(),
    setSelection: vi.fn(),
    groupCompoundOperation: vi.fn((_label, action) => action()),
  }),
}));

vi.mock('@varve/engine', async (importOriginal) => ({
  // Reuse the real candidate resolver without a source-path import: importing
  // engine sources directly pulls them into the editor tsconfig rootDir.
  getDdColorModelCandidates: (await importOriginal<typeof import('@varve/engine')>())
    .getDdColorModelCandidates,
  getModelById: () => undefined,
  colorizationPipeline: {
    resolveRuntime: vi.fn(),
    execute: vi.fn().mockRejectedValue(new Error('not mocked')),
  },
  analyzeImageData: vi.fn(() => ({
    meanLuminance: 0.5,
    saturationStd: 0.02,
    fractionNearNeutral: 0.9,
    fractionLowSaturation: 0.95,
    edgeDensity: 0.05,
    width: 100,
    height: 100,
  })),
  classifyTask: vi.fn(() => ({
    sourceKind: 'photo',
    recommendedWorkflow: 'photo-colorize',
    confidence: 0.9,
  })),
  listAllModels: vi.fn(() => []),
  getModelLoaderReady: models.ready,
}));

vi.mock('@varve/scene', () => ({
  imageShapeSrc: vi.fn(() => 'data:image/png;base64,mock'),
  isImageShape: vi.fn(() => true),
}));

vi.mock('@varve/ui', async () => ({
  ...(await vi.importActual('@varve/ui')),
  // Mirrors the real Button's availability contract: a disabledReason makes the
  // control aria-disabled (still focusable and clickable, but a no-op) rather
  // than HTML-disabled. Tests that only saw a plain `disabled` prop could not
  // distinguish "not yet ready" from "ready", which hid the checking stall.
  Button: ({ children, onClick, disabled, softDisabled, loading, disabledReason, variant }) => {
    const reasonActive = disabledReason !== undefined && (disabled || softDisabled) && !loading;
    const htmlDisabled = !loading && !softDisabled && !reasonActive && disabled;
    const ariaDisabled = loading || softDisabled || reasonActive || undefined;
    return (
      <button
        type="button"
        onClick={ariaDisabled ? undefined : onClick}
        disabled={htmlDisabled || undefined}
        aria-disabled={ariaDisabled}
        title={reasonActive ? disabledReason : undefined}
        data-variant={variant}
      >
        {children}
      </button>
    );
  },
  // Mirrors the real Select: labelled via aria-label, native <option> children,
  // and onChange handed the option value rather than the event.
  Select: ({ label, value, options, onChange, disabled }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {(options ?? []).map((o: { value: string; label: string }) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({ label, checked, disabled, onChange, className }) => (
    <label className={className}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label}
    </label>
  ),
  // Mirrors the canonical radiogroup contract: labelled group, one checked
  // radio per option, disabled options skipped by the pointer path.
  SegmentedControl: ({ label, value, options, onChange, disabled }) => (
    <div role="radiogroup" aria-label={label}>
      {(options ?? []).map((o: { value: string; label: string; disabled?: boolean }) => (
        // biome-ignore lint/a11y/useSemanticElements: test double mirrors the canonical APG radiogroup markup
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({ modelId }: { modelId: string }) => (
    <div role="dialog" aria-label={`Install ${modelId}`} />
  ),
}));

import { ColorizeSection } from '../ColorizeSection';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  models.available.mockReset().mockResolvedValue(false);
  models.subscribe.mockReturnValue(models.unsubscribe);
  models.ready.mockReset().mockResolvedValue({
    isModelAvailable: models.available,
    subscribe: models.subscribe,
  });
});

const makeImageNode = (overrides = {}) => ({
  id: 'node-1',
  kind: 'shape',
  name: 'Test Image',
  shape: { kind: 'rect', w: 100, h: 100 },
  fills: [{ type: 'image', src: 'data:image/png;base64,dummy', fit: 'fill' }],
  ...overrides,
});

// The real Button reports "not yet" via aria-disabled (still clickable, but a
// no-op that surfaces disabledReason) rather than the disabled attribute, so
// availability has to be read from both. Reading only `.disabled` cannot tell
// "not installed" from "still checking", which is what hid the stall.
const previewButton = () => screen.getByRole('button', { name: /preview/i });
const previewUnavailable = () =>
  previewButton().disabled || previewButton().getAttribute('aria-disabled') === 'true';

describe('ColorizeSection', () => {
  it('renders workflow selector', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Colorization workflow')).toBeTruthy();
  });

  it('renders all workflow options', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    expect(select).toBeTruthy();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.textContent)).toEqual([
      'Photo Colorization (AI)',
      'Tint / Selective Recolor',
      'Line art (color hints)',
      'Palette Colorize',
      'Reference Transfer',
      'Harmonize',
    ]);
  });

  it('renders recolor controls by default', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText('Target absolute hue in degrees')).toBeTruthy();
    expect(screen.getByLabelText('Saturation scale')).toBeTruthy();
  });

  it('renders quality mode buttons', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    expect(screen.getByRole('radio', { name: 'Fast' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Quality' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeTruthy();
  });

  it('renders chroma slider for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/chroma strength/i)).toBeTruthy();
  });

  it('renders skin protection switch for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('switch', { name: /Protect skin-like pixels/ })).toBeTruthy();
  });

  it('renders neutral protection switch for recolor workflow', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('switch', { name: 'Protect near-neutral pixels' })).toBeTruthy();
  });

  it('renders palette hint when palette workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'palette' } });
    expect(screen.getByText(/Select document swatches/i)).toBeTruthy();
  });

  it('renders transfer hint when transfer workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'transfer' } });
    expect(screen.getByRole('button', { name: 'Choose reference image' })).toBeTruthy();
  });

  it('renders luminance preservation slider', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/source lightness preservation/i)).toBeTruthy();
  });

  it('renders blend strength slider', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByLabelText(/blend strength/i)).toBeTruthy();
  });

  it('renders palette adherence slider when palette workflow selected', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    const select = screen.getByLabelText('Colorization workflow');
    fireEvent.change(select, { target: { value: 'palette' } });
    expect(screen.getByLabelText(/palette adherence/i)).toBeTruthy();
  });

  it('renders preview button by default', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.getByRole('button', { name: /preview/i })).toBeTruthy();
  });

  it('does not render cancel button when idle', () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('shows DDColor model hint when no models available', async () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() =>
      expect(screen.getByText(/No verified DDColor model installed/i)).toBeTruthy(),
    );
  });

  it('returns null when no node provided', () => {
    const { container } = render(<ColorizeSection nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('requires the large model for Balanced even when Tiny is installed', async () => {
    models.available.mockImplementation(async (id: string) => id === 'ddcolor-tiny');
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(models.subscribe).toHaveBeenCalled());
    expect(previewUnavailable()).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Fast' }));
    await waitFor(() => expect(previewUnavailable()).toBe(false));
    fireEvent.click(screen.getByRole('radio', { name: 'Quality' }));
    expect(previewUnavailable()).toBe(true);
  });

  it('requires Tiny for Fast even when the large model is installed', async () => {
    models.available.mockImplementation(async (id: string) => id === 'ddcolor');
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(previewUnavailable()).toBe(false));
    fireEvent.click(screen.getByRole('radio', { name: 'Fast' }));
    await waitFor(() => expect(previewUnavailable()).toBe(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Automatic' }));
    await waitFor(() => expect(previewUnavailable()).toBe(false));
  });

  it('shows a retryable status failure instead of claiming an artifact is missing', async () => {
    models.available.mockRejectedValue(new Error('Model storage could not be read.'));
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('storage'));
    expect(screen.queryByText(/No verified DDColor model installed/i)).toBeNull();
    models.available.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry model check' }));
    await waitFor(() => expect(previewUnavailable()).toBe(false));
  });

  it('discards an earlier readiness check when a removal notification overtakes it', async () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(models.subscribe).toHaveBeenCalled());
    const notify = models.subscribe.mock.calls[0][0];
    let finish!: (value: boolean) => void;
    models.available.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => notify());
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => notify());
    await act(async () => finish(true));
    expect(previewUnavailable()).toBe(true);
  });

  it('does not subscribe after the panel unmounts during loader initialization', async () => {
    let finish!: (value: object) => void;
    models.ready.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(models.ready).toHaveBeenCalled());
    view.unmount();
    await act(async () =>
      finish({ isModelAvailable: models.available, subscribe: models.subscribe }),
    );
    expect(models.subscribe).not.toHaveBeenCalled();
  });

  it('opens acquisition for the exact missing model selected by the quality mode', async () => {
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Download DDColor' }));
    expect(screen.getByRole('dialog', { name: 'Install ddcolor' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Fast' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download DDColor Tiny' }));
    expect(screen.getByRole('dialog', { name: 'Install ddcolor-tiny' })).toBeTruthy();
  });

  it('keeps Preview inert while the quality mode is still checking installation', async () => {
    // Regression: a mode switch clears the readiness snapshot while the new
    // check runs. Ignoring that window left the button aria-disabled-but-clickable
    // with no explanation, so a real click stalled silently instead of reporting
    // that installation was still being verified.
    // Both models report installed so the mode change is a pure re-check, not a
    // genuine miss: the button must be available before, inert during, and
    // available again after.
    models.available.mockResolvedValue(true);
    render(<ColorizeSection nodes={[makeImageNode()]} />);
    fireEvent.change(screen.getByLabelText('Colorization workflow'), {
      target: { value: 'photo' },
    });
    await waitFor(() => expect(models.subscribe).toHaveBeenCalled());
    await waitFor(() => expect(previewUnavailable()).toBe(false));

    let finishCheck!: () => void;
    models.available.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCheck = () => resolve(true);
        }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Quality' }));
    });
    await waitFor(() => expect(finishCheck).toBeTypeOf('function'));

    const preview = previewButton();
    expect(previewUnavailable()).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Checking model installation/i);
    // The inert control must explain itself rather than swallow the click.
    expect(preview.title).toMatch(/Checking whether this quality mode/i);

    await act(async () => finishCheck());
    await waitFor(() => expect(previewUnavailable()).toBe(false));
    // No reason is active once the mode is ready, so no explanation is shown.
    expect(preview.getAttribute('title')).toBeNull();
  });
});
