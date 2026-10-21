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
    localStorage.clear();
    resetModelLoader();
    vi.unstubAllGlobals();
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
});
