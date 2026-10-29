import {
  downloadNativeGenerativeModel,
  getModelLoader,
  getNativeGenerativeModelStatus,
  importNativeGenerativeModel,
  isWasmModelSafe,
  NATIVE_GENERATIVE_MODEL_PROFILE,
  qualifyNativeGenerativeModel,
} from '@varve/engine';
import { useCallback, useEffect } from 'react';
import { MODEL_ID } from './constants';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived;
export function useModelStatus(params: Params) {
  const {
    capabilities,
    diffusionDownloadAbortRef,
    diffusionModelImportAvailable,
    downloadAbortRef,
    isOpen,
    qualificationAbortRef,
    qualificationRunRef,
    setDiffusionModelDownloadAvailable,
    setDiffusionModelHandle,
    setDiffusionModelImportAvailable,
    setDiffusionModelInstalled,
    setDiffusionModelQualificationAvailable,
    setDiffusionModelReason,
    setDiffusionModelSize,
    setDiffusionResource,
    setDownloadProgress,
    setErrorMessage,
    setModelAvailable,
    setModelFitsMemory,
    setStatus,
  } = params;
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const isNative = capabilities.resourceProfile.executionBackend === 'native';
      const [available, fitsMemory] = await Promise.all([
        loader.isModelAvailable(MODEL_ID),
        isNative ? Promise.resolve(true) : isWasmModelSafe(MODEL_ID),
      ]);
      if (!cancelled) {
        setModelAvailable(available);
        setModelFitsMemory(fitsMemory);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capabilities.resourceProfile.executionBackend, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void getNativeGenerativeModelStatus().then((available) => {
      if (cancelled) return;
      setDiffusionModelInstalled(available.installed);
      setDiffusionModelDownloadAvailable(available.downloadAvailable);
      setDiffusionModelImportAvailable(available.importAvailable === true);
      setDiffusionModelQualificationAvailable(available.qualificationAvailable);
      setDiffusionModelHandle(available.ready ? available.modelHandle : null);
      setDiffusionModelSize(available.sizeBytes);
      setDiffusionModelReason(available.reason);
      setDiffusionResource({
        availableBytes: available.memoryAvailableBytes ?? null,
        requiredBytes:
          available.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: available.resourceTier ?? 'unknown',
        backend: available.executionBackend ?? 'unknown',
        platform: available.platform ?? 'unknown',
        architecture: available.architecture ?? 'unknown',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setModelAvailable(true);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Download failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, []);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
    diffusionDownloadAbortRef.current?.abort();
  }, []);

  const handleCancelQualification = useCallback(() => {
    qualificationAbortRef.current?.abort();
    qualificationAbortRef.current = null;
    qualificationRunRef.current += 1;
    setStatus('idle');
  }, []);

  const handleDownloadDiffusionModel = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    diffusionDownloadAbortRef.current = controller;
    try {
      const downloaded = await downloadNativeGenerativeModel(({ loaded, total }) => {
        setDownloadProgress(
          total > 0
            ? Math.round((loaded / total) * 100)
            : Math.round((loaded / NATIVE_GENERATIVE_MODEL_PROFILE.sizeBytes) * 100),
        );
      }, controller.signal);
      setDiffusionModelInstalled(downloaded.installed);
      setDiffusionModelDownloadAvailable(downloaded.downloadAvailable);
      setDiffusionModelImportAvailable(downloaded.importAvailable === true);
      setDiffusionModelQualificationAvailable(downloaded.qualificationAvailable);
      setDiffusionModelHandle(downloaded.ready ? downloaded.modelHandle : null);
      setDiffusionModelSize(downloaded.sizeBytes);
      setDiffusionModelReason(downloaded.reason);
      setDiffusionResource({
        availableBytes: downloaded.memoryAvailableBytes ?? null,
        requiredBytes:
          downloaded.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: downloaded.resourceTier ?? 'unknown',
        backend: downloaded.executionBackend ?? 'unknown',
        platform: downloaded.platform ?? 'unknown',
        architecture: downloaded.architecture ?? 'unknown',
      });
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be downloaded.',
      );
    } finally {
      diffusionDownloadAbortRef.current = null;
    }
  }, []);

  const handleImportDiffusionModel = useCallback(async () => {
    if (!diffusionModelImportAvailable) {
      setErrorMessage(
        'This build has no model-specific local import adapter. Arbitrary model files are not accepted.',
      );
      return;
    }
    try {
      const tauri = (
        window as Window & {
          __TAURI__?: {
            core?: {
              invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            };
          };
        }
      ).__TAURI__;
      if (!tauri?.core?.invoke) {
        throw new Error('Model installation is available in the desktop app only.');
      }
      const picked = (await tauri.core.invoke('plugin:dialog|open', {
        options: {
          multiple: false,
          filters: [{ name: 'Diffusion model', extensions: ['safetensors', 'gguf'] }],
        },
      })) as Array<{ path?: string }> | null;
      const selected = picked?.[0]?.path;
      if (!selected) return;
      const imported = await importNativeGenerativeModel(selected);
      setDiffusionModelInstalled(imported.installed);
      setDiffusionModelDownloadAvailable(imported.downloadAvailable);
      setDiffusionModelImportAvailable(imported.importAvailable === true);
      setDiffusionModelQualificationAvailable(imported.qualificationAvailable);
      setDiffusionModelHandle(imported.ready ? imported.modelHandle : null);
      setDiffusionModelSize(imported.sizeBytes);
      setDiffusionModelReason(imported.reason);
      setDiffusionResource({
        availableBytes: imported.memoryAvailableBytes ?? null,
        requiredBytes:
          imported.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: imported.resourceTier ?? 'unknown',
        backend: imported.executionBackend ?? 'unknown',
        platform: imported.platform ?? 'unknown',
        architecture: imported.architecture ?? 'unknown',
      });
      setErrorMessage(null);
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be installed.',
      );
    }
  }, [diffusionModelImportAvailable]);

  const handleQualifyDiffusionModel = useCallback(async () => {
    const runId = qualificationRunRef.current + 1;
    qualificationRunRef.current = runId;
    const isCurrentQualification = () => qualificationRunRef.current === runId;
    const controller = new AbortController();
    qualificationAbortRef.current?.abort();
    qualificationAbortRef.current = controller;
    setStatus('qualifying');
    setErrorMessage(null);
    try {
      const qualified = await qualifyNativeGenerativeModel(controller.signal);
      if (!isCurrentQualification()) return;
      setDiffusionModelInstalled(qualified.installed);
      setDiffusionModelDownloadAvailable(qualified.downloadAvailable);
      setDiffusionModelImportAvailable(qualified.importAvailable === true);
      setDiffusionModelQualificationAvailable(qualified.qualificationAvailable);
      setDiffusionModelHandle(qualified.ready ? qualified.modelHandle : null);
      setDiffusionModelSize(qualified.sizeBytes);
      setDiffusionModelReason(qualified.reason);
      setDiffusionResource({
        availableBytes: qualified.memoryAvailableBytes ?? null,
        requiredBytes:
          qualified.memoryRequiredBytes ?? NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
        tier: qualified.resourceTier ?? 'unknown',
        backend: qualified.executionBackend ?? 'unknown',
        platform: qualified.platform ?? 'unknown',
        architecture: qualified.architecture ?? 'unknown',
      });
      if (!qualified.ready) throw new Error(qualified.reason ?? 'Model qualification failed.');
      setStatus('idle');
    } catch (err) {
      if (!isCurrentQualification()) return;
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'The diffusion model could not be qualified.',
      );
    } finally {
      if (qualificationAbortRef.current === controller) qualificationAbortRef.current = null;
    }
  }, []);
  return {
    handleCancelDownload,
    handleCancelQualification,
    handleDownload,
    handleDownloadDiffusionModel,
    handleImportDiffusionModel,
    handleQualifyDiffusionModel,
  };
}

export type DialogModelStatus = ReturnType<typeof useModelStatus>;
