// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ModelManifestEntry } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListAllModels,
  mockDeleteModel,
  mockDownloadModel,
  mockGetModelLoaderReady,
  mockVerifyBundled,
  mockReadiness,
} = vi.hoisted(() => ({
  mockListAllModels: vi.fn(),
  mockDeleteModel: vi.fn(),
  mockDownloadModel: vi.fn(),
  mockGetModelLoaderReady: vi.fn(),
  mockVerifyBundled: vi.fn().mockResolvedValue('verified'),
  mockReadiness: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    getModelLoaderReady: mockGetModelLoaderReady,
    listAllModels: mockListAllModels,
    getBackgroundRemovalReadiness: mockReadiness,
    workerModelIdForMethod: (m: string) =>
      m === 'ai-balanced' ? 'u2netp' : m === 'ai-quality' ? 'birefnet-general-lite' : null,
  };
});

vi.mock('../BackgroundRemoval/ModelDownloadDialog', () => ({
  ModelDownloadDialog: ({ modelId, onComplete }: { modelId: string; onComplete: () => void }) => (
    <div data-testid="download-dialog">
      <span>Downloading {modelId}</span>
      <button type="button" onClick={onComplete}>
        Simulate complete
      </button>
    </div>
  ),
}));

import { BgRemovalModelsTab } from './BgRemovalModelsTab';

function entry(overrides: Partial<ModelManifestEntry> & { id: string }): ModelManifestEntry {
  return {
    name: overrides.id,
    description: '',
    sizeBytes: 0,
    remoteUrl: '',
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3,
    category: 'segmentation',
    ...overrides,
  };
}

function mockLoader(installedIds: Set<string>) {
  return {
    isModelAvailable: vi.fn((id: string) => Promise.resolve(installedIds.has(id))),
    hasDownloadedBlob: vi.fn((id: string) => Promise.resolve(installedIds.has(id))),
    deleteModel: mockDeleteModel.mockResolvedValue(undefined),
    downloadModel: mockDownloadModel.mockImplementation(
      async (_id: string, onProgress?: (loaded: number, total: number) => void) => {
        onProgress?.(100, 100);
      },
    ),
    verifyBundledModel: mockVerifyBundled,
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('BgRemovalModelsTab — storage transparency + control', () => {
  beforeEach(() => {
    mockListAllModels.mockReset();
    mockDeleteModel.mockReset();
    mockDownloadModel.mockReset();
    mockGetModelLoaderReady.mockReset();
    mockVerifyBundled.mockResolvedValue('verified');
    mockReadiness.mockImplementation(async (_method: string, modelId: string) => {
      const installed = await (await mockGetModelLoaderReady()).isModelAvailable(modelId);
      return {
        modelId,
        installed,
        canAttempt: installed,
        runtime: 'Browser CPU',
        summary: installed ? 'Installed' : 'Download required',
        recovery: null,
        enhancedInstalled: false,
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('releases its model-loader subscription on unmount', async () => {
    mockListAllModels.mockReturnValue([]);
    const loader = mockLoader(new Set());
    const unsubscribe = vi.fn();
    loader.subscribe.mockReturnValue(unsubscribe);
    mockGetModelLoaderReady.mockResolvedValue(loader);
    const view = render(<BgRemovalModelsTab />);
    await waitFor(() => expect(loader.subscribe).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe after unmount while loader initialization was pending', async () => {
    mockListAllModels.mockReturnValue([]);
    const loader = mockLoader(new Set());
    let finish!: (value: typeof loader) => void;
    mockGetModelLoaderReady.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<BgRemovalModelsTab />);
    view.unmount();
    await act(async () => {
      finish(loader);
    });
    expect(loader.subscribe).not.toHaveBeenCalled();
  });

  it('keeps a failed removal visible beside its model', async () => {
    mockListAllModels.mockReturnValue([entry({ id: 'birefnet-general', name: 'BiRefNet Full' })]);
    const loader = mockLoader(new Set(['birefnet-general']));
    mockDeleteModel.mockRejectedValue(new Error('Permission denied. Check the model folder.'));
    mockGetModelLoaderReady.mockResolvedValue(loader);
    render(<BgRemovalModelsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /remove birefnet full model/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Permission denied'));
    expect(screen.getByRole('button', { name: /remove birefnet full model/i })).toBeEnabled();
  });

  it('keeps an installed model removable when its native runtime is unavailable', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'pinned',
      }),
    ]);
    const loader = mockLoader(new Set(['birefnet-general-lite']));
    loader.isModelAvailable.mockResolvedValue(false);
    mockGetModelLoaderReady.mockResolvedValue(loader);
    mockReadiness.mockResolvedValue({
      modelId: 'birefnet-general-lite',
      installed: true,
      canAttempt: false,
      runtime: 'Native runtime unavailable',
      summary: 'Native runtime unavailable',
      recovery: 'Restart the desktop app.',
      enhancedInstalled: false,
    });
    render(<BgRemovalModelsTab />);
    expect(
      await screen.findByRole('button', { name: /remove birefnet lite model/i }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /download birefnet lite model/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Native runtime unavailable/)).toHaveTextContent(
      'Restart the desktop app.',
    );
  });

  it('keeps other model rows usable and retries a failed native status probe in place', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'pinned',
      }),
      entry({
        id: 'scunet',
        name: 'SCUNet',
        remoteUrl: 'https://example.com/scunet.onnx',
        checksum: 'pinned',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['birefnet-general-lite'])));
    mockReadiness.mockRejectedValueOnce(
      new Error('Could not read native model status. Retry the model check.'),
    );
    render(<BgRemovalModelsTab />);
    expect(await screen.findByRole('button', { name: /download scunet model/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /remove birefnet lite model/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /retry birefnet lite model check/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('lists every known model with size and install status, even before any download', async () => {
    mockListAllModels.mockReturnValue([
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_574_861, bundled: true }),
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        peakMemoryBytes: 900_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
      entry({
        id: 'birefnet-general',
        name: 'BiRefNet Full',
        sizeBytes: 380_000_000,
        remoteUrl: 'https://example.com/full.onnx',
        checksum: 'full-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['u2netp'])));

    render(<BgRemovalModelsTab />);

    await waitFor(() => expect(screen.getByText('BiRefNet Lite')).toBeInTheDocument());
    expect(screen.getByText('BiRefNet Full')).toBeInTheDocument();
    expect(screen.getAllByText(/not installed/i)).toHaveLength(2);
    expect(screen.getByText(/Download\/storage ~120 MB/)).toBeInTheDocument();
    // Storage location must be disclosed, not hidden.
    expect(screen.getByText(/stored in/i)).toBeInTheDocument();
  });

  it('shows a Remove action only for user-downloaded models, never for bundled ones', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_700_000, bundled: true }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(
      mockLoader(new Set(['birefnet-general-lite', 'u2netp'])),
    );

    render(<BgRemovalModelsTab />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /remove birefnet lite model/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /remove u²-net light model/i }),
    ).not.toBeInTheDocument();
  });

  it('deletes the model and refreshes the list on click', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['birefnet-general-lite'])));

    render(<BgRemovalModelsTab />);
    const deleteBtn = await screen.findByRole('button', { name: /remove birefnet lite model/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('birefnet-general-lite'));
  });

  it('opens the consent-gated download dialog for a not-installed single-file model', async () => {
    mockListAllModels.mockReturnValue([
      entry({
        id: 'birefnet-general-lite',
        name: 'BiRefNet Lite',
        sizeBytes: 120_000_000,
        remoteUrl: 'https://example.com/lite.onnx',
        checksum: 'lite-checksum',
      }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

    render(<BgRemovalModelsTab />);
    const downloadBtn = await screen.findByRole('button', {
      name: /download birefnet lite model$/i,
    });
    fireEvent.click(downloadBtn);

    expect(screen.getByTestId('download-dialog')).toBeInTheDocument();
    expect(screen.getByText(/downloading birefnet-general-lite/i)).toBeInTheDocument();
  });

  it('surfaces corrupt bundled model warning on first open', async () => {
    mockVerifyBundled.mockResolvedValue('corrupt');
    mockListAllModels.mockReturnValue([
      entry({ id: 'u2netp', name: 'U²-Net Light', sizeBytes: 4_700_000, bundled: true }),
    ]);
    mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['u2netp'])));

    render(<BgRemovalModelsTab />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/failed integrity check/i),
    );
    expect(mockVerifyBundled).toHaveBeenCalledWith('u2netp');
  });

  describe('multi-component models (SAM2 encoder + decoder)', () => {
    function sam2Catalog(): ModelManifestEntry[] {
      return [
        entry({
          id: 'sam2-hiera-tiny',
          name: 'SAM2 Tiny',
          sizeBytes: 0,
          multiComponent: true,
          components: [
            {
              id: 'sam2-hiera-tiny-encoder',
              role: 'encoder',
              filename: 'encoder.onnx',
              sizeBytes: 134_000_000,
              remoteUrl: 'https://example.com/encoder.onnx',
            },
            {
              id: 'sam2-hiera-tiny-decoder',
              role: 'decoder',
              filename: 'decoder.onnx',
              sizeBytes: 21_000_000,
              remoteUrl: 'https://example.com/decoder.onnx',
            },
          ],
        }),
        // These are real catalog entries in their own right (other tools
        // address them directly by id) but must not also render as rows.
        entry({
          id: 'sam2-hiera-tiny-encoder',
          name: 'Select Subject — Image Encoder',
          sizeBytes: 134_000_000,
          remoteUrl: 'https://example.com/encoder.onnx',
        }),
        entry({
          id: 'sam2-hiera-tiny-decoder',
          name: 'Select Subject — Prompt Decoder',
          sizeBytes: 21_000_000,
          remoteUrl: 'https://example.com/decoder.onnx',
        }),
      ];
    }

    it('shows exactly one row for the composite model, not one per component', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

      render(<BgRemovalModelsTab />);

      await waitFor(() => expect(screen.getByText('SAM2 Tiny')).toBeInTheDocument());
      expect(screen.queryByText('Select Subject — Image Encoder')).not.toBeInTheDocument();
      expect(screen.queryByText('Select Subject — Prompt Decoder')).not.toBeInTheDocument();
      // Combined size of both components (134MB + 21MB = 155MB).
      expect(screen.getByText(/~155 MB/)).toBeInTheDocument();
    });

    it('reports installed only when every component is installed', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      // Only the encoder is downloaded — decoder still missing.
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set(['sam2-hiera-tiny-encoder'])));

      render(<BgRemovalModelsTab />);

      await waitFor(() => expect(screen.getByText('SAM2 Tiny')).toBeInTheDocument());
      expect(screen.getByText(/not installed/i)).toBeInTheDocument();
    });

    it('downloads every component with one click and reports combined progress', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      mockGetModelLoaderReady.mockResolvedValue(mockLoader(new Set()));

      render(<BgRemovalModelsTab />);
      const downloadBtn = await screen.findByRole('button', { name: /download sam2 tiny model/i });
      fireEvent.click(downloadBtn);

      await waitFor(() => expect(mockDownloadModel).toHaveBeenCalledTimes(2));
      expect(mockDownloadModel).toHaveBeenCalledWith(
        'sam2-hiera-tiny-encoder',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      expect(mockDownloadModel).toHaveBeenCalledWith(
        'sam2-hiera-tiny-decoder',
        expect.any(Function),
        expect.any(AbortSignal),
      );
      // No per-component dialog — the composite flow never opens one.
      expect(screen.queryByTestId('download-dialog')).not.toBeInTheDocument();
    });

    it('retains a failed component error and supports retry on the same row', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      const loader = mockLoader(new Set());
      mockDownloadModel.mockRejectedValueOnce(new Error('Download interrupted. Check connection.'));
      mockGetModelLoaderReady.mockResolvedValue(loader);
      render(<BgRemovalModelsTab />);
      fireEvent.click(await screen.findByRole('button', { name: /download sam2 tiny model/i }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Download interrupted'),
      );
      const row = screen.getByText('SAM2 Tiny').closest('li')!;
      fireEvent.click(within(row).getByRole('button', { name: /retry sam2 tiny/i }));
      await waitFor(() => expect(mockDownloadModel).toHaveBeenCalledTimes(3));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('cancels an in-flight component download when the settings tab unmounts', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      const loader = mockLoader(new Set());
      let finish!: () => void;
      mockDownloadModel.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      mockGetModelLoaderReady.mockResolvedValue(loader);
      const view = render(<BgRemovalModelsTab />);
      fireEvent.click(await screen.findByRole('button', { name: /download sam2 tiny model/i }));
      await waitFor(() => expect(mockDownloadModel).toHaveBeenCalledTimes(1));
      const signal = mockDownloadModel.mock.calls[0]?.[2] as AbortSignal;
      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish();
      });
      expect(mockDownloadModel).toHaveBeenCalledTimes(1);
    });

    it('bases combined progress on all parts, including the one not started yet', async () => {
      mockListAllModels.mockReturnValue(sam2Catalog());
      const loader = mockLoader(new Set());
      let finish!: () => void;
      mockDownloadModel.mockImplementation((_id, onProgress) => {
        onProgress(134_000_000, 134_000_000);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      mockGetModelLoaderReady.mockResolvedValue(loader);
      const view = render(<BgRemovalModelsTab />);
      fireEvent.click(await screen.findByRole('button', { name: /download sam2 tiny model/i }));
      const progress = await screen.findByRole('progressbar');
      await waitFor(() => expect(progress).toHaveAttribute('aria-valuenow', '86'));
      view.unmount();
      await act(async () => {
        finish();
      });
    });
  });
});
