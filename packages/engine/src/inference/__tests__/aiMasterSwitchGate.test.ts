// @vitest-environment jsdom
/**
 * Central AI master-switch contract.
 *
 * Every registered model must refuse download and session load when
 * `ai.enabled` is false. This is the regression that fails if a new model
 * is added to the catalog but the choke-point gate is bypassed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelLoader, resetModelLoader } from '../../backgroundRemoval/modelLoader';
import { DownloadManager } from '../core/DownloadManager';
import { InferenceError } from '../core/InferenceError';
import { createModelStorage } from '../core/ModelStorage';
import { listAllModels } from '../modelCatalog';
import { SessionManager } from '../SessionManager';

function disableAi(): void {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
}

function enableAi(): void {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
}

describe('AI master switch choke point', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    resetModelLoader();
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error('network must not run while AI is off'));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetModelLoader();
  });

  it('refuses download and session load for every registered model when ai.enabled is false', async () => {
    disableAi();
    const models = listAllModels();
    expect(models.length).toBeGreaterThan(0);

    const loader = getModelLoader();
    const manager = new SessionManager(3, async () => {
      throw new Error('ONNX must not load while AI is off');
    });
    const downloads = new DownloadManager(createModelStorage('memory'));

    for (const entry of models) {
      await expect(
        loader.downloadModel(entry.id),
        `loader.downloadModel(${entry.id})`,
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
      );

      await expect(
        downloads.startDownload(entry.id),
        `DownloadManager.startDownload(${entry.id})`,
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
      );

      await expect(
        manager.getSession(`/tmp/${entry.id}.onnx`, entry.id),
        `SessionManager.getSession(${entry.id})`,
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
      );
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still allows session creation when the switch is on', async () => {
    enableAi();
    const create = vi.fn(async () => ({
      run: vi.fn(async () => ({})),
      release: vi.fn(async () => undefined),
      inputNames: ['input'],
      outputNames: ['output'],
    }));
    const manager = new SessionManager(3, async () => ({
      InferenceSession: { create },
      Tensor: class FakeTensor {},
    }));

    const session = await manager.getSession('/tmp/u2netp.onnx', 'u2netp');
    expect(session.modelId).toBe('u2netp');
    expect(create).toHaveBeenCalled();
  });

  it('refuses generative edit and native model download when ai.enabled is false', async () => {
    disableAi();
    const { runGenerativeEdit } = await import('../../generativeEdit/pipeline');
    const { downloadNativeGenerativeModel } = await import('../../generativeEdit/nativeModel');
    const mask = new Uint8Array(144);
    mask[65] = 255;

    await expect(
      runGenerativeEdit({
        mode: 'remove',
        imageData: new ImageData(12, 12),
        mask,
        maskWidth: 12,
        maskHeight: 12,
        quality: 'draft',
        seed: 1,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
    await expect(downloadNativeGenerativeModel()).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
  });

  it('refuses Real-ESRGAN upscale session creation when ai.enabled is false', async () => {
    disableAi();
    const { upscaleWithRealEsrgan } = await import('../../upscaleProviders/aiUpscale');
    await expect(
      upscaleWithRealEsrgan(new ImageData(1, 1), '/models/realesr.onnx', () => false),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
  });

  it('treats a missing localStorage as enabled so worker-side asserts are no-ops', async () => {
    const { getAiFeaturesEnabled, assertAiFeaturesEnabled } = await import('../aiFeaturesGate');
    vi.stubGlobal('localStorage', undefined);
    expect(getAiFeaturesEnabled()).toBe(true);
    expect(() => assertAiFeaturesEnabled()).not.toThrow();
  });

  it('refuses AI worker-host dispatch on the main thread when the switch is off', async () => {
    disableAi();
    const posted: unknown[] = [];
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

    const { runUpscaleInWorker, runUpscaleInWorkerWithMetadata, resetEnhancementWorkerForTests } =
      await import('../../upscaleProviders/enhancementWorkerHost');
    resetEnhancementWorkerForTests();
    const image = new ImageData(1, 1);
    await expect(
      runUpscaleInWorkerWithMetadata(image, { method: 'ai', scale: 2 }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
    await expect(runUpscaleInWorker(image, { method: 'ai', scale: 2 })).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
    expect(posted).toHaveLength(0);

    const { runPooledInference, terminateWorkerPool } = await import(
      '../../backgroundRemoval/workerPool'
    );
    await expect(
      runPooledInference(image, { method: 'ai-balanced' }, '/tmp/u2netp.onnx', 'u2netp'),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof InferenceError && error.code === 'ai_disabled',
    );
    expect(posted).toHaveLength(0);
    terminateWorkerPool();
    resetEnhancementWorkerForTests();
  });
});
