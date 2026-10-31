// @vitest-environment jsdom
/**
 * Central AI master-switch contract.
 *
 * Every registered model must refuse download and session load when
 * `ai.enabled` is false. This is the regression that fails if a new model
 * is added to the catalog but the choke-point gate is bypassed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelLoader, resetModelLoader } from '../../backgroundRemoval/modelLoader';
import {
  applyWorkerAiGate,
  getAiFeaturesEnabled,
  notifyAiFeaturesSettingsChanged,
  resetAiFeaturesGateForTests,
} from '../aiFeaturesGate';
import { DownloadManager } from '../core/DownloadManager';
import { InferenceError } from '../core/InferenceError';
import { createModelStorage } from '../core/ModelStorage';
import { listAllModels } from '../modelCatalog';
import { SessionManager } from '../SessionManager';

function disableAi(): void {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
  notifyAiFeaturesSettingsChanged();
}

function enableAi(): void {
  localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
  notifyAiFeaturesSettingsChanged();
}

describe('AI master switch choke point', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    resetAiFeaturesGateForTests();
    resetModelLoader();
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error('network must not run while AI is off'));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    resetAiFeaturesGateForTests();
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

  it('defaults on when the settings key is missing', () => {
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('defaults on when a readable blob has no ai object', () => {
    localStorage.setItem(
      'varve-editor-settings',
      JSON.stringify({ appearance: { theme: 'dark' } }),
    );
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('fails closed and logs when the settings blob is corrupt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('varve-editor-settings', '{"ai":');
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ai-gate]'));
    warn.mockRestore();
  });

  it('does not throw when window exists without addEventListener', () => {
    const previous = globalThis.window;
    globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
    resetAiFeaturesGateForTests();
    expect(() => getAiFeaturesEnabled()).not.toThrow();
    expect(getAiFeaturesEnabled()).toBe(true);
    globalThis.window = previous;
  });

  it('fails closed and logs when localStorage is unreadable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(() => applyWorkerAiGate(undefined)).toThrow(InferenceError);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('accepts an explicit worker snapshot so worker-side asserts can refuse', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => applyWorkerAiGate(false)).toThrow(InferenceError);
    expect(() => applyWorkerAiGate(true)).not.toThrow();
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('clears a prior true snapshot when a later job omits aiEnabled', () => {
    enableAi();
    expect(() => applyWorkerAiGate(true)).not.toThrow();
    expect(getAiFeaturesEnabled()).toBe(true);
    expect(() => applyWorkerAiGate(undefined)).toThrow(InferenceError);
    vi.stubGlobal('localStorage', undefined);
    expect(getAiFeaturesEnabled()).toBe(false);
  });

  it('honours strata-editor-settings when the current key is absent', () => {
    localStorage.setItem('strata-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    expect(getAiFeaturesEnabled()).toBe(false);
  });

  it('prefers varve-editor-settings over the legacy key', () => {
    localStorage.setItem('strata-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('logs the unreadable warning only once until settings change', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('varve-editor-settings', '{"ai":');
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    notifyAiFeaturesSettingsChanged();
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('does not re-export test-only configure/reset helpers from public barrels', () => {
    const engineIndex = readFileSync(resolve(__dirname, '../../index.ts'), 'utf-8');
    const inferenceIndex = readFileSync(resolve(__dirname, '../index.ts'), 'utf-8');
    expect(engineIndex).not.toContain('configureAiFeaturesEnabled');
    expect(engineIndex).not.toContain('resetAiFeaturesGateForTests');
    expect(inferenceIndex).not.toContain('configureAiFeaturesEnabled');
    expect(inferenceIndex).not.toContain('resetAiFeaturesGateForTests');
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

  it('the three model-loading workers enforce the gate inside the worker', () => {
    const workers = [
      'inference/inferenceWorker.ts',
      'upscaleProviders/enhancementWorker.ts',
      'backgroundRemoval/worker.ts',
    ];
    for (const relative of workers) {
      const source = readFileSync(resolve(__dirname, '../../', relative), 'utf-8');
      expect(source, relative).toContain('applyWorkerAiGate');
    }
  });
});
