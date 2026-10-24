// @ts-nocheck
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockIsModelAvailable: vi.fn().mockResolvedValue(false),
  mockHasDownloadedBlob: vi.fn().mockResolvedValue(false),
  mockSubscribe: vi.fn(() => () => {}),
  ready: vi.fn(),
  unsubscribe: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@varve/engine', () => ({
  getRuntimeCapabilitiesSync: () => ({ isTauri: false }),
  resolveModelPeakMemoryBytes: (
    entry: { peakMemoryBytes?: number; nativePeakMemoryBytes?: number },
    options?: { native?: boolean },
  ) =>
    options?.native && entry.nativePeakMemoryBytes !== undefined
      ? entry.nativePeakMemoryBytes
      : entry.peakMemoryBytes,
  resolveAcquisition: (entry: { bundled: boolean; remoteUrl: string; checksum: string }) => {
    if (entry.bundled)
      return {
        kind: 'bundled',
        assetPath: `/models/${entry.id}.onnx`,
        sha256: entry.checksum || '',
      };
    if (entry.remoteUrl && entry.checksum)
      return {
        kind: 'remote',
        sources: [{ url: entry.remoteUrl, sha256: entry.checksum }],
        sha256: entry.checksum,
      };
    return {
      kind: 'unavailable',
      reasonCode: 'source-unavailable',
      detail: 'No download source available',
    };
  },
  getModelLoaderReady: mocks.ready,
  listAllModels: vi.fn(() => [
    {
      id: 'ddcolor',
      name: 'DDColor',
      sizeBytes: 156_000_000,
      bundled: false,
      remoteUrl: 'https://huggingface.co/piddnad/ddcolor_modelscope/resolve/main/ddcolor.onnx',
      checksum: 'abc123',
      description: 'Photo-realistic grayscale colorization',
      precision: 'fp32',
    },
    {
      id: 'ddcolor-tiny',
      name: 'DDColor Tiny',
      sizeBytes: 50_000_000,
      bundled: false,
      remoteUrl: 'https://huggingface.co/piddnad/ddcolor_paper_tiny/resolve/main/ddcolor-tiny.onnx',
      checksum: 'def456',
      description: 'Fast preview colorization',
      precision: 'fp32',
    },
  ]),
}));

vi.mock('@varve/ui', () => ({
  Button: ({ children, onClick, disabled, variant, 'aria-label': label }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      aria-label={label}
    >
      {children}
    </button>
  ),
  RegionLoader: ({ children, label, loading }) =>
    loading ? (
      <div role="status" aria-label={label}>
        Loading...
      </div>
    ) : (
      <div role="none">{children}</div>
    ),
}));

vi.mock('../../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({ modelId, onClose }) => (
    <div data-testid="model-download-dialog" data-model-id={modelId}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

import { ColorizationModelsTab } from '../ColorizationModelsTab';

afterEach(cleanup);

describe('ColorizationModelsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsModelAvailable.mockReset().mockResolvedValue(false);
    mocks.mockHasDownloadedBlob.mockReset().mockResolvedValue(false);
    mocks.mockSubscribe.mockReturnValue(mocks.unsubscribe);
    mocks.ready.mockReset().mockResolvedValue({
      isModelAvailable: mocks.mockIsModelAvailable,
      hasDownloadedBlob: mocks.mockHasDownloadedBlob,
      subscribe: mocks.mockSubscribe,
      deleteModel: mocks.remove,
    });
    mocks.remove.mockReset().mockResolvedValue(undefined);
  });

  it('renders section title', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText('Colorization Models')).toBeTruthy();
  });

  it('renders hint text about DDColor models', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText(/DDColor models propose plausible colors/i)).toBeTruthy();
  });

  it('renders model rows for ddcolor and ddcolor-tiny', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText('DDColor')).toBeTruthy();
    expect(await screen.findByText('DDColor Tiny')).toBeTruthy();
  });

  it('shows download buttons for uninstalled models', async () => {
    render(<ColorizationModelsTab />);
    const dlButtons = await screen.findAllByText('Download');
    expect(dlButtons).toHaveLength(2);
  });

  it('shows Remove button for installed downloaded models', async () => {
    mocks.mockIsModelAvailable.mockResolvedValue(true);
    mocks.mockHasDownloadedBlob.mockResolvedValue(true);
    render(<ColorizationModelsTab />);
    const removeButtons = await screen.findAllByText('Remove');
    expect(removeButtons.length).toBeGreaterThan(0);
  });

  it('shows size info for each model', async () => {
    render(<ColorizationModelsTab />);
    expect(await screen.findByText(/156 MB/)).toBeTruthy();
    expect(await screen.findByText(/50 MB/)).toBeTruthy();
  });

  it('unsubscribes the live model-list listener on unmount', async () => {
    const view = render(<ColorizationModelsTab />);
    await screen.findByText('DDColor Tiny');
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not subscribe after late initialization of an unmounted list', async () => {
    let finish!: (value: object) => void;
    mocks.ready.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ColorizationModelsTab />);
    view.unmount();
    await act(async () =>
      finish({ isModelAvailable: mocks.mockIsModelAvailable, subscribe: mocks.mockSubscribe }),
    );
    expect(mocks.mockSubscribe).not.toHaveBeenCalled();
  });

  it('retains a failed removal and allows retry instead of losing the error', async () => {
    mocks.mockIsModelAvailable.mockResolvedValue(true);
    mocks.mockHasDownloadedBlob.mockResolvedValue(true);
    mocks.remove.mockRejectedValueOnce(new Error('Model file is in use.'));
    render(<ColorizationModelsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove DDColor model' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('file is in use'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove DDColor model' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('retains other models and distinguishes a status error from a missing artifact', async () => {
    mocks.mockIsModelAvailable.mockImplementation(async (id: string) => {
      if (id === 'ddcolor') throw new Error('Cannot read DDColor storage.');
      return false;
    });
    render(<ColorizationModelsTab />);
    await screen.findByText('DDColor Tiny');
    expect(screen.getByRole('alert').textContent).toContain('Cannot read DDColor storage');
    expect(screen.queryByRole('button', { name: 'Download DDColor model' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download DDColor Tiny model' })).toBeTruthy();
    mocks.mockIsModelAvailable.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading models' }));
    await screen.findByRole('button', { name: 'Download DDColor model' });
  });

  it('ignores a stale installed result overtaken by a removal notification', async () => {
    render(<ColorizationModelsTab />);
    await screen.findByRole('button', { name: 'Download DDColor model' });
    const notify = mocks.mockSubscribe.mock.calls[0][0];
    let finish!: (value: boolean) => void;
    mocks.mockIsModelAvailable.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => notify());
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => notify());
    await act(async () => finish(true));
    expect(screen.getByRole('button', { name: 'Download DDColor model' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove DDColor model' })).toBeNull();
  });

  it('retries failed initialization and installs a live subscription after recovery', async () => {
    mocks.ready.mockRejectedValueOnce(new Error('Model service unavailable.'));
    render(<ColorizationModelsTab />);
    expect((await screen.findByRole('alert')).textContent).toContain('Model service unavailable');
    expect(screen.queryByText('No colorization models found in the catalog.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading models' }));
    await screen.findByRole('button', { name: 'Download DDColor model' });
    expect(mocks.mockSubscribe).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
