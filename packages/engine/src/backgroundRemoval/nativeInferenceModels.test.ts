import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@varve/platform', () => ({ isTauriRuntime: isTauri }));

import {
  nativeDeleteInferenceModel,
  nativeDownloadInferenceModel,
  nativeInferenceModelExternalData,
  nativeInferenceModelPath,
} from './nativeInferenceModels';

describe('nativeInferenceModels', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    listen.mockReset();
    isTauri.mockReset();
    listen.mockResolvedValue(vi.fn());
  });

  it('does nothing outside Tauri', async () => {
    isTauri.mockReturnValue(false);
    expect(await nativeInferenceModelPath('ddcolor-tiny')).toBeNull();
    expect(await nativeInferenceModelExternalData('scunet')).toBeNull();
    expect(await nativeDeleteInferenceModel('ddcolor-tiny')).toBe(false);
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'r1',
        modelId: 'ddcolor-tiny',
      }),
    ).rejects.toThrow('desktop');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resolves an installed native model path', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue('/home/user/.local/share/varve/models/ddcolor-tiny.onnx');
    expect(await nativeInferenceModelPath('ddcolor-tiny')).toBe(
      '/home/user/.local/share/varve/models/ddcolor-tiny.onnx',
    );
    expect(invoke).toHaveBeenCalledWith('inference_model_path', { modelId: 'ddcolor-tiny' });
  });

  it('treats a null native path as genuinely not installed', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(null);
    expect(await nativeInferenceModelPath('ddcolor-tiny')).toBeNull();
  });

  it('surfaces native path status errors instead of reporting the model missing', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error('Model store is locked by another operation'));
    await expect(nativeInferenceModelPath('ddcolor-tiny')).rejects.toThrow('Model store is locked');
  });

  it('forwards matching progress events and unlistens', async () => {
    isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    type ProgressHandler = (event: {
      payload: { requestId: string; modelId: string; loaded: number; total: number };
    }) => void;
    let handler: ProgressHandler | undefined;
    listen.mockImplementation((_event: string, callback: ProgressHandler) => {
      handler = callback;
      return Promise.resolve(unlisten);
    });
    invoke.mockResolvedValue('/models/ddcolor.onnx');
    const onProgress = vi.fn();

    const result = await nativeDownloadInferenceModel({
      requestId: 'req-1',
      modelId: 'ddcolor-tiny',
      onProgress,
    });

    expect(result).toBe('/models/ddcolor.onnx');
    expect(invoke).toHaveBeenCalledWith('download_inference_model', {
      requestId: 'req-1',
      modelId: 'ddcolor-tiny',
    });
    handler?.({ payload: { requestId: 'other', modelId: 'x', loaded: 5, total: 10 } });
    expect(onProgress).not.toHaveBeenCalled();
    handler?.({ payload: { requestId: 'req-1', modelId: 'ddcolor-tiny', loaded: 50, total: 100 } });
    expect(onProgress).toHaveBeenCalledWith(50, 100);
    expect(unlisten).toHaveBeenCalled();
  });

  it('cancels a native download after it starts', async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    let rejectDownload: ((error: Error) => void) | undefined;
    invoke.mockImplementation((command: string) => {
      if (command === 'download_inference_model') {
        return new Promise((_resolve, reject) => {
          rejectDownload = reject;
        });
      }
      return Promise.resolve(undefined);
    });
    const controller = new AbortController();

    const pending = nativeDownloadInferenceModel({
      requestId: 'req-2',
      modelId: 'ddcolor-tiny',
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'download_inference_model',
        expect.objectContaining({ requestId: 'req-2' }),
      );
    });
    controller.abort();
    expect(invoke).toHaveBeenCalledWith('cancel_inference_model_download', {
      requestId: 'req-2',
    });
    rejectDownload?.(new Error('Download cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('rejects an already-aborted download without starting it', async () => {
    isTauri.mockReturnValue(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'req-early',
        modelId: 'ddcolor-tiny',
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(invoke).not.toHaveBeenCalledWith('download_inference_model', expect.anything());
  });

  it('surfaces native verification failures', async () => {
    isTauri.mockReturnValue(true);
    listen.mockResolvedValue(vi.fn());
    invoke.mockRejectedValue(new Error('Model SHA-256 mismatch'));
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'req-3',
        modelId: 'ddcolor-tiny',
      }),
    ).rejects.toThrow('SHA-256');
  });

  it('cleans up cancellation when progress-listener setup fails', async () => {
    isTauri.mockReturnValue(true);
    listen.mockRejectedValue(new Error('IPC listener unavailable'));
    const controller = new AbortController();
    await expect(
      nativeDownloadInferenceModel({
        requestId: 'setup-failed',
        modelId: 'ddcolor-tiny',
        signal: controller.signal,
      }),
    ).rejects.toThrow('IPC listener unavailable');
    controller.abort();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not start acquisition when cancelled while the progress listener is pending', async () => {
    isTauri.mockReturnValue(true);
    let ready!: (unlisten: () => void) => void;
    listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
    );
    const controller = new AbortController();
    const unlisten = vi.fn();
    const pending = nativeDownloadInferenceModel({
      requestId: 'setup-cancelled',
      modelId: 'ddcolor-tiny',
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    controller.abort();
    ready(unlisten);
    await rejected;
    expect(invoke).not.toHaveBeenCalledWith('download_inference_model', expect.anything());
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('rejects a cancelled download even when native installation wins the completion race', async () => {
    isTauri.mockReturnValue(true);
    let finish!: (path: string) => void;
    invoke.mockImplementation((command: string) =>
      command === 'download_inference_model'
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    const controller = new AbortController();
    const pending = nativeDownloadInferenceModel({
      requestId: 'late-install',
      modelId: 'ddcolor-tiny',
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    finish('/models/ddcolor-tiny.onnx');
    await rejected;
  });

  it('surfaces native deletion errors so model settings can show recovery', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error('Model file is read-only'));
    await expect(nativeDeleteInferenceModel('ddcolor-tiny')).rejects.toThrow('read-only');
  });

  it('converts verified native weights to an asset URL without losing the graph filename', async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue({
      filename: 'scunet_color_real_psnr.onnx.data',
      path: '/models/scunet_color_real_psnr.onnx.data',
    });
    expect(await nativeInferenceModelExternalData('scunet')).toEqual({
      path: 'scunet_color_real_psnr.onnx.data',
      url: 'asset://localhost//models/scunet_color_real_psnr.onnx.data',
    });
    expect(invoke).toHaveBeenCalledWith('inference_model_external_data', { modelId: 'scunet' });
  });
});
