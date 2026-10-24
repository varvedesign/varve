// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { nativePath, externalData, loadBlob, hasBlob } = vi.hoisted(() => ({
  nativePath: vi.fn(),
  externalData: vi.fn(),
  loadBlob: vi.fn(),
  hasBlob: vi.fn(),
}));
vi.mock('@varve/platform', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock('../nativeInferenceModels', () => ({
  nativeInferenceModelPath: nativePath,
  nativeInferenceModelExternalData: externalData,
}));
vi.mock('../modelStore', () => ({ loadModelBlob: loadBlob, hasModelBlob: hasBlob }));

import { getModelEntry, resetManifestCache } from '../../inference/manifest';
import { getModelLoaderReady, resetModelLoader } from '../modelLoader';

const manifest = JSON.parse(
  readFileSync('apps/desktop/public/models/manifest.json', 'utf8'),
) as unknown;

describe('native model artifact resolution', () => {
  beforeEach(() => {
    resetModelLoader();
    localStorage.clear();
    resetManifestCache();
    vi.clearAllMocks();
    loadBlob.mockResolvedValue(null);
    hasBlob.mockResolvedValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/models/manifest.json'
          ? new Response(JSON.stringify(manifest), {
              headers: { 'content-type': 'application/json' },
            })
          : new Response('missing', { status: 404 }),
      ),
    );
  });
  afterEach(() => {
    resetModelLoader();
    vi.unstubAllGlobals();
    resetManifestCache();
  });

  it('resolves the nested TrOCR encoder as its real graph rather than a grouping', async () => {
    const entry = await getModelEntry('trocr-encoder');
    expect(entry?.remoteUrl).toContain('/onnx/encoder_model.onnx');
    expect(entry?.checksum).toBe(
      '31e9b9a2950c4b0d5d884665414ec3dec36186237955463c07a30e5f3fcd8ea0',
    );
    expect(entry?.sizeBytes).toBe(344_487_712);
  });

  it('accepts a complete verified native graph-and-sidecar installation without IndexedDB', async () => {
    nativePath.mockImplementation(async (id: string) =>
      id === 'scunet' ? '/models/scunet.onnx' : null,
    );
    const loader = await getModelLoaderReady();
    expect(await loader.isModelAvailable('scunet')).toBe(true);
    expect(hasBlob).not.toHaveBeenCalled();
    expect(nativePath).not.toHaveBeenCalledWith('scunet__externaldata');
  });

  it('propagates a failed native path check instead of reporting the model missing', async () => {
    nativePath.mockRejectedValue(new Error('Native model store is unavailable'));
    const loader = await getModelLoaderReady();
    await expect(loader.isModelAvailable('scunet')).rejects.toThrow(
      'Native model store is unavailable',
    );
  });

  it('does not fall through to browser storage when the native store has no copy', async () => {
    // On desktop the native store is the authority for a non-bundled graph.
    // A null native result must not fall through to the dev-server HEAD probe
    // or IndexedDB, which would advertise a path the native executor cannot
    // open. Browser storage stays the fallback only outside Tauri.
    nativePath.mockResolvedValue(null);
    hasBlob.mockResolvedValue(true);
    const loader = await getModelLoaderReady();
    await expect(loader.getModelPath('scunet')).resolves.toBeNull();
  });

  it('resolves native external weights with the graph-declared filename', async () => {
    externalData.mockResolvedValue({
      path: 'scunet_color_real_psnr.onnx.data',
      url: 'asset://localhost/models/scunet_color_real_psnr.onnx.data',
    });
    const loader = await getModelLoaderReady();
    expect(await loader.getModelExternalData('scunet')).toEqual({
      path: 'scunet_color_real_psnr.onnx.data',
      url: 'asset://localhost/models/scunet_color_real_psnr.onnx.data',
    });
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it('makes composite OCR ready only when encoder, decoder and tokenizer are all installed', async () => {
    const installed = new Set(['trocr-encoder', 'trocr-decoder']);
    nativePath.mockImplementation(async (id: string) =>
      installed.has(id) ? `/models/${id}` : null,
    );
    const loader = await getModelLoaderReady();
    expect(await loader.isModelAvailable('tr-ocr-base-printed')).toBe(false);
    installed.add('trocr-tokenizer');
    expect(await loader.isModelAvailable('tr-ocr-base-printed')).toBe(true);
    installed.delete('trocr-encoder');
    expect(await loader.isModelAvailable('tr-ocr-base-printed')).toBe(false);
  });
});
