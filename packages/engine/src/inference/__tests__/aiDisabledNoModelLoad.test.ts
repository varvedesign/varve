// @vitest-environment jsdom
/**
 * With AI turned off, no model file is requested or loaded.
 * Intercepts fetch, Worker construction, and ONNX session creation while
 * every engine AI entry point is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAiFeaturesGateForTests } from '../aiFeaturesGate';
import { InferenceError } from '../core/InferenceError';

function disableAi(): void {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
}

describe('AI off loads no model files', () => {
  const fetchSpy = vi.fn();
  const posted: unknown[] = [];

  beforeEach(() => {
    localStorage.clear();
    resetAiFeaturesGateForTests();
    posted.length = 0;
    fetchSpy.mockReset();
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      throw new Error(`model fetch must not run while AI is off: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    class FakeWorker {
      onmessage: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      postMessage(msg: unknown) {
        posted.push(msg);
      }
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetAiFeaturesGateForTests();
  });

  it('refuses every engine AI entry point without fetching or posting a model job', async () => {
    disableAi();
    const isDisabled = (error: unknown) =>
      (error instanceof InferenceError && error.code === 'ai_disabled') ||
      (error instanceof Error && /AI features are disabled/i.test(error.message));

    const { getModelLoader, resetModelLoader } = await import(
      '../../backgroundRemoval/modelLoader'
    );
    resetModelLoader();
    const loader = getModelLoader();
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(loader.downloadModel('u2netp')).rejects.toSatisfy(isDisabled);
    await expect(loader.downloadModel('depth-anything-v2-small')).rejects.toSatisfy(isDisabled);
    await expect(loader.downloadModel('tr-ocr-base-printed')).rejects.toSatisfy(isDisabled);
    await expect(loader.downloadModel('sam2-hiera-small')).rejects.toSatisfy(isDisabled);

    const { DownloadManager } = await import('../core/DownloadManager');
    const { createModelStorage } = await import('../core/ModelStorage');
    const { listAllModels } = await import('../modelCatalog');
    const downloads = new DownloadManager(createModelStorage('memory'));
    for (const entry of listAllModels()) {
      downloads.registerModel(entry);
      await expect(downloads.startDownload(entry.id)).rejects.toSatisfy(isDisabled);
    }

    const { SessionManager } = await import('../SessionManager');
    const sessions = new SessionManager(3, async () => {
      throw new Error('ONNX runtime must not load while AI is off');
    });
    await expect(sessions.getSession('/tmp/u2netp.onnx', 'u2netp')).rejects.toSatisfy(isDisabled);

    const { getInferenceWorkerHost, disposeInferenceWorkerHost } = await import(
      '../inferenceWorkerHost'
    );
    const host = getInferenceWorkerHost();
    await expect(
      host.infer({
        type: 'infer',
        modelType: 'depth',
        modelPath: '/models/depth-anything-v2-small.onnx',
        modelId: 'depth-anything-v2-small',
        imageData: new ImageData(8, 8),
      }),
    ).rejects.toSatisfy(isDisabled);
    disposeInferenceWorkerHost();

    const { runGenerativeEdit } = await import('../../generativeEdit/pipeline');
    const { downloadNativeGenerativeModel, importNativeGenerativeModel } = await import(
      '../../generativeEdit/nativeModel'
    );
    const mask = new Uint8Array(64);
    mask[0] = 255;
    await expect(
      runGenerativeEdit({
        mode: 'remove',
        imageData: new ImageData(8, 8),
        mask,
        maskWidth: 8,
        maskHeight: 8,
        quality: 'draft',
        seed: 1,
      }),
    ).rejects.toSatisfy(isDisabled);
    await expect(downloadNativeGenerativeModel()).rejects.toSatisfy(isDisabled);
    await expect(importNativeGenerativeModel('/tmp/imported.gguf')).rejects.toSatisfy(isDisabled);

    const { upscaleWithRealEsrgan } = await import('../../upscaleProviders/aiUpscale');
    await expect(
      upscaleWithRealEsrgan(new ImageData(1, 1), '/models/realesr.onnx', () => false),
    ).rejects.toSatisfy(isDisabled);

    const { runUpscaleInWorker, runUpscaleInWorkerWithMetadata, resetEnhancementWorkerForTests } =
      await import('../../upscaleProviders/enhancementWorkerHost');
    resetEnhancementWorkerForTests();
    await expect(
      runUpscaleInWorker(new ImageData(1, 1), { method: 'ai', scale: 2 }),
    ).rejects.toSatisfy(isDisabled);
    await expect(
      runUpscaleInWorkerWithMetadata(new ImageData(1, 1), { method: 'ai', scale: 2 }),
    ).rejects.toSatisfy(isDisabled);

    const { runPooledInference, terminateWorkerPool } = await import(
      '../../backgroundRemoval/workerPool'
    );
    await expect(
      runPooledInference(
        new ImageData(1, 1),
        { method: 'ai-balanced' },
        '/tmp/u2netp.onnx',
        'u2netp',
      ),
    ).rejects.toSatisfy(isDisabled);

    const { removeBackground } = await import('../../backgroundRemoval/index');
    await expect(
      removeBackground(new ImageData(8, 8), { method: 'ai-balanced' }),
    ).rejects.toSatisfy(isDisabled);
    await expect(removeBackground(new ImageData(8, 8), { method: 'ai-quality' })).rejects.toSatisfy(
      isDisabled,
    );

    const { runPrecisionBenchmark } = await import('../../backgroundRemoval/precisionCapabilities');
    await expect(runPrecisionBenchmark()).rejects.toSatisfy(isDisabled);

    const { qualifyNativeGenerativeModel } = await import('../../generativeEdit/nativeModel');
    await expect(qualifyNativeGenerativeModel()).rejects.toSatisfy(isDisabled);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);

    terminateWorkerPool();
    resetEnhancementWorkerForTests();
    resetModelLoader();
  });
});
