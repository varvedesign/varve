import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  status: vi.fn(),
  installed: vi.fn(),
  path: vi.fn(),
  caps: vi.fn(),
  safe: vi.fn(),
}));
vi.mock('./providers/tauriProvider', () => ({
  getNativeBackgroundRemovalModelStatus: boundary.status,
}));
vi.mock('./modelLoader', () => ({
  getModelLoaderReady: async () => ({
    isModelAvailable: boundary.installed,
    getModelPath: boundary.path,
    hasDownloadedBlob: boundary.installed,
  }),
}));
vi.mock('./environmentCapabilities', () => ({
  getEnvironmentCapabilities: boundary.caps,
  isWasmModelSafe: boundary.safe,
}));

// Exercise the same facts the action and inline disclosure consume. No model
// execution is replaced or claimed by these readiness-only regressions.
import { getBackgroundRemovalReadiness } from './modelReadiness';

describe('background-removal readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.status.mockResolvedValue(null);
    boundary.installed.mockResolvedValue(false);
    boundary.path.mockResolvedValue(null);
    boundary.caps.mockResolvedValue({
      isTauri: false,
      hasWorker: true,
      hasWebGPU: false,
      hasWebGL: false,
      isWebKitGTK: false,
    });
    boundary.safe.mockResolvedValue(true);
  });

  it('keeps an installed native model distinct from an unavailable runtime', async () => {
    boundary.status.mockResolvedValue({ installed: true, runtimeReady: false });
    boundary.caps.mockResolvedValue({ isTauri: true, hasWorker: true });
    const result = await getBackgroundRemovalReadiness('ai-quality');
    expect(result).toMatchObject({
      installed: true,
      canAttempt: false,
      modelId: 'birefnet-general-lite',
    });
    expect(result.summary).toMatch(/runtime unavailable/i);
    expect(result.recovery).toMatch(/restart|reinstall/i);
  });

  it('offers acquisition for a missing model without calling it a runtime failure', async () => {
    boundary.status.mockResolvedValue({ installed: false, runtimeReady: true });
    boundary.caps.mockResolvedValue({ isTauri: true, hasWorker: true });
    expect(await getBackgroundRemovalReadiness('ai-quality')).toMatchObject({
      installed: false,
      canAttempt: false,
      summary: 'Download required',
      runtime: 'Native CPU',
    });
  });

  it('does not hide a browser limit just because the bytes are installed', async () => {
    boundary.installed.mockResolvedValue(true);
    boundary.path.mockResolvedValue('blob:verified');
    boundary.safe.mockResolvedValue(false);
    const result = await getBackgroundRemovalReadiness('ai-quality');
    expect(result).toMatchObject({ installed: true, canAttempt: false });
    expect(result.summary).toMatch(/browser/i);
    expect(result.recovery).not.toMatch(/download|GPU|fallback/i);
  });

  it('names native CPU only after a successful runtime probe', async () => {
    boundary.status.mockResolvedValue({ installed: true, runtimeReady: true });
    boundary.caps.mockResolvedValue({ isTauri: true });
    expect(await getBackgroundRemovalReadiness('ai-quality')).toMatchObject({
      installed: true,
      canAttempt: true,
      runtime: 'Native CPU',
      summary: 'Installed',
    });
  });

  it('checks the exact native MODNet artifact for portrait matting', async () => {
    boundary.status.mockResolvedValue({ installed: true, runtimeReady: true });
    boundary.caps.mockResolvedValue({ isTauri: true });
    expect(await getBackgroundRemovalReadiness('portrait')).toMatchObject({
      installed: true,
      canAttempt: true,
      modelId: 'modnet-portrait',
      runtime: 'Native CPU',
    });
    expect(boundary.status).toHaveBeenCalledWith('modnet-portrait');
    expect(boundary.safe).not.toHaveBeenCalled();
  });

  it('does not infer a working model from browser GPU detection', async () => {
    boundary.caps.mockResolvedValue({ isTauri: false, hasWorker: true, hasWebGPU: true });
    boundary.installed.mockResolvedValue(true);
    boundary.path.mockResolvedValue('blob:verified');
    boundary.safe.mockResolvedValue(false);
    const result = await getBackgroundRemovalReadiness('ai-quality');
    expect(result).toMatchObject({ installed: true, canAttempt: true });
    expect(result.summary).toMatch(/support checked on use/i);
  });

  it('uses the bundled Auto model when the enhanced model is absent', async () => {
    boundary.installed.mockImplementation(async (id: string) => id === 'u2netp');
    boundary.path.mockImplementation(async (id: string) =>
      id === 'u2netp' ? '/models/u2netp.onnx' : null,
    );
    expect(await getBackgroundRemovalReadiness('ai-balanced')).toMatchObject({
      installed: true,
      modelId: 'u2netp',
      canAttempt: true,
    });
  });

  it('reports a failed native status probe rather than falling into browser or download advice', async () => {
    boundary.caps.mockResolvedValue({ isTauri: true, hasWorker: true });
    await expect(getBackgroundRemovalReadiness('ai-quality')).rejects.toThrow(
      /native.*status.*retry/i,
    );
  });

  it('surfaces a failed native status probe as retryable instead of claiming the model is missing', async () => {
    // Regression: the status bridge used to swallow the IPC rejection into
    // `null`, so readiness reported "Download required" for a model that may
    // already be verified on disk. The error must propagate to the readiness
    // hook, which renders it with a retry action.
    boundary.caps.mockResolvedValue({ isTauri: true, hasWorker: true });
    boundary.status.mockRejectedValue(new Error('Native model store is unavailable'));
    await expect(getBackgroundRemovalReadiness('ai-quality')).rejects.toThrow(
      'Native model store is unavailable',
    );
  });

  it('keeps missing Auto native artifacts on the native route', async () => {
    boundary.caps.mockResolvedValue({ isTauri: true, hasWorker: true });
    boundary.status.mockResolvedValue({ installed: false, runtimeReady: true });
    expect(await getBackgroundRemovalReadiness('ai-balanced')).toMatchObject({
      installed: false,
      runtime: 'Native CPU',
      summary: 'Download required',
    });
  });

  it.each(['u2netp', 'u2netp-int8'] as const)(
    'keeps %s on its CPU-only route when an adapter exists',
    async (modelId) => {
      boundary.caps.mockResolvedValue({
        isTauri: false,
        hasWorker: true,
        hasWebGPU: true,
        hasWebGL: true,
      });
      boundary.installed.mockResolvedValue(true);
      expect(await getBackgroundRemovalReadiness('ai-balanced', modelId)).toMatchObject({
        installed: true,
        canAttempt: true,
        runtime: 'Browser CPU',
        summary: 'Installed',
      });
    },
  );

  it('requires no model or runtime probe for Fast', async () => {
    boundary.caps.mockRejectedValue(new Error('Runtime unavailable'));
    expect(await getBackgroundRemovalReadiness('quick')).toMatchObject({
      modelId: null,
      installed: true,
      canAttempt: true,
    });
  });
});
