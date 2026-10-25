/**
 * Native (Tauri) download bridge for generic inference models.
 *
 * Browser `fetch` cannot read GitHub release assets because they carry no
 * CORS headers; the desktop app downloads them in Rust instead, verifies the
 * catalog SHA-256 before exposing them, and returns a path that the loader
 * converts to a Tauri asset URL for the ONNX worker.
 *
 * Every function is a no-op outside Tauri so the web build keeps using the
 * existing IndexedDB path.
 */
import { isTauriRuntime } from '@varve/platform';

export interface NativeInferenceModelDownloadOptions {
  requestId: string;
  modelId: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

interface NativeInferenceProgress {
  requestId: string;
  modelId: string;
  loaded: number;
  total: number;
}

/**
 * Absolute path of an installed native inference model, if any.
 *
 * `null` means the native store authoritatively has no verified copy. A failed
 * status check REJECTS instead of returning `null`: collapsing an IPC or
 * verification error into "not installed" makes readiness offer a download
 * for a model that may already be on disk, and hides the retryable fault. The
 * Rust command distinguishes these itself — `Ok(None)` is absent, `Err` is a
 * failed verification.
 */
export async function nativeInferenceModelPath(modelId: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const path = await invoke<string | null>('inference_model_path', { modelId });
  return path ?? null;
}

/** A sidecar is exposed only after the native store verifies the whole model. */
export async function nativeInferenceModelExternalData(
  modelId: string,
): Promise<{ path: string; url: string } | null> {
  if (!isTauriRuntime()) return null;
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
  const artifact = await invoke<{ filename: string; path: string } | null>(
    'inference_model_external_data',
    { modelId },
  );
  return artifact ? { path: artifact.filename, url: convertFileSrc(artifact.path) } : null;
}

/**
 * Download and verify a model through the native command. Resolves with the
 * installed file path; rejects when the download is cancelled, incomplete, or
 * fails hash verification.
 */
export async function nativeDownloadInferenceModel(
  options: NativeInferenceModelDownloadOptions,
): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('Native model downloads are only available on desktop');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const cancel = () => {
    void invoke('cancel_inference_model_download', {
      requestId: options.requestId,
    }).catch(() => undefined);
  };
  if (options.signal?.aborted) {
    throw new Error('Download cancelled');
  }
  const unlisten = await listen<NativeInferenceProgress>('inference-model-progress', (event) => {
    if (event.payload.requestId !== options.requestId) return;
    options.onProgress?.(event.payload.loaded, event.payload.total);
  });
  try {
    // Nothing native has started while listener setup is pending. Recheck
    // first, then own the abort listener only for the actual command lifetime.
    if (options.signal?.aborted) throw new Error('Download cancelled');
    options.signal?.addEventListener('abort', cancel, { once: true });
    const path = await invoke<string>('download_inference_model', {
      requestId: options.requestId,
      modelId: options.modelId,
    });
    if (options.signal?.aborted) throw new Error('Download cancelled');
    return path;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    unlisten();
  }
}

export async function nativeDeleteInferenceModel(modelId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('delete_inference_model', { modelId });
}
