/**
 * Orchestrates background removal via an ordered provider chain (Strategy pattern).
 *
 * Quick mode bypasses AI providers entirely. Browser AI tries Worker ONNX,
 * main-thread ONNX, then cloud. Desktop prefers native ONNX when its runtime
 * is ready, then follows the browser chain. AI never silently returns a
 * heuristic result.
 *
 * Provider dispatch safety: each provider receives an independent immutable
 * pixel buffer clone. A worker transfer must never detach the source used by
 * a later fallback. Timeouts abort provider work rather than merely rejecting
 * the caller.
 *
 * Memory-aware fallback: if ai-quality (BiRefNet) fails through every provider,
 * the dispatch automatically retries with ai-balanced (u2netp) instead of
 * crashing or showing a cryptic error. The caller receives the fallback result
 * with method set to 'ai-balanced' and can check whether the quality was
 * reduced.
 */

import {
  estimateInferenceReservation,
  getInferenceAdmission,
  InferenceAdmissionError,
  type InferenceLease,
} from '../../inference/admission';
import { getModelById } from '../../inference/modelCatalog';
import { removeBackgroundHeuristic } from '../heuristic';
import { cloneImageData } from '../protocol';
import type { BackgroundRemovalOptions, BackgroundRemovalResult, RemovalMethod } from '../types';
import { workerModelIdForMethod } from '../types';
import { cloudRemovalProvider } from './cloudProvider';
import { directOnnxRemovalProvider } from './directOnnxProvider';
import { isNativeAiReady, tauriRemovalProvider } from './tauriProvider';
import type { RemovalProvider } from './types';
import { workerRemovalProvider } from './workerProvider';

/**
 * Ordered AI inference providers — first success wins. This is the default/
 * base order (ADR-0005): Worker ONNX first on every platform, since it's
 * the one path guaranteed to exist everywhere, with Tauri-native as a
 * second-tier fallback.
 *
 * Native-ready desktop builds reorder this below so enhanced Balanced and
 * Quality can run outside the webview's WASM memory ceiling.
 */
export const AI_PROVIDER_CHAIN: RemovalProvider[] = [
  workerRemovalProvider,
  tauriRemovalProvider,
  directOnnxRemovalProvider,
  cloudRemovalProvider,
];

/**
 * Enhanced Balanced (IS-Net) and Quality (BiRefNet) can exceed safe bare-WASM
 * memory and, in the worst case, crash with std::bad_alloc on
 * GPU-less hosts (docs/audits/background-removal-wasm-memory-hardening-
 * 2026-07-18.md — reproduced deterministically at ~4GB RSS, the wasm32
 * linear-memory ceiling). Native execution of the same model peaks around
 * 445MB. When the Tauri desktop build has successfully loaded a native
 * onnxruntime dylib (`isNativeAiReady()` — a runtime-verified check, not
 * just "the ai feature was compiled in"), prefer it over Worker ONNX. If the
 * selected native model is absent, dispatch continues to the worker fallback
 * (U²-Net Light for Balanced).
 */
async function getProviderOrder(
  options: BackgroundRemovalOptions,
  deadline: number,
  signal?: AbortSignal,
): Promise<RemovalProvider[]> {
  // MODNet portrait matting is a web-worker-only local path: there is no
  // native bridge model for it and it must never silently become a cloud or
  // heuristic run. A single-provider chain keeps the failure honest.
  if (options.method === 'portrait') {
    return [workerRemovalProvider];
  }
  const nativeReady = await withTimeout(
    () => isNativeAiReady(),
    Math.max(0, Math.min(5_000, deadline - performance.now())),
    signal,
  ).catch((error) => {
    if (signal?.aborted) throw error;
    return false;
  });
  if (options.method !== 'quick' && nativeReady) {
    return [
      tauriRemovalProvider,
      workerRemovalProvider,
      directOnnxRemovalProvider,
      cloudRemovalProvider,
    ];
  }
  return AI_PROVIDER_CHAIN;
}

/** Hard ceiling for any single provider attempt (including model loading). */
const BALANCED_PROVIDER_TIMEOUT = 125_000;
const QUALITY_PROVIDER_TIMEOUT = 310_000;

function withTimeout<T>(
  start: (attemptSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const controller = new AbortController();
    const onCallerAbort = () => {
      cleanup();
      reject(new Error('cancelled'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Provider timed out'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      controller.abort();
      signal?.removeEventListener('abort', onCallerAbort);
    };

    signal?.addEventListener('abort', onCallerAbort, { once: true });

    let promise: Promise<T>;
    try {
      promise = start(controller.signal);
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Run the full provider chain with the given options.
 * Returns the result on success, or null if all providers failed.
 */
async function tryProviderChain(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  deadline: number,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult | null> {
  const providerTimeout =
    options.method === 'ai-quality' ? QUALITY_PROVIDER_TIMEOUT : BALANCED_PROVIDER_TIMEOUT;
  const errors: string[] = [];
  let attempted = false;

  const providers = await getProviderOrder(options, deadline, signal);
  for (const provider of providers) {
    if (signal?.aborted) {
      throw new Error('cancelled');
    }

    const remaining = () => Math.max(0, deadline - performance.now());
    if (remaining() === 0) throw requestDeadlineError();

    let available: boolean;
    try {
      available = await withTimeout(
        (attemptSignal) => Promise.resolve(provider.isAvailable(options, attemptSignal)),
        Math.min(5_000, remaining()),
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      continue;
    }
    if (!available) continue;
    if (remaining() === 0) throw requestDeadlineError();
    attempted = true;

    try {
      const clonedImage = cloneImageData(imageData);
      return await withTimeout(
        (attemptSignal) => provider.remove(clonedImage, options, attemptSignal),
        Math.min(providerTimeout, remaining()),
        signal,
      );
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      errors.push(`${provider.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // If we get here and attempted but all failed, log diagnostics and return null
  if (attempted && errors.length > 0) {
    console.warn(`[bg-removal] All providers failed for ${options.method}:`, errors.join('; '));
  }

  if (performance.now() >= deadline) throw requestDeadlineError();
  return null; // All providers failed or none available
}

function requestDeadlineError(): Error {
  return new Error(
    'AI background removal reached its request deadline. Try Fast mode for a simple background, or use a smaller local model in Settings, Offline Models.',
  );
}

/**
 * The shared local-work ledger refused this job for lack of working memory.
 * Distinct from a provider failure: nothing was attempted, so callers can
 * retry a lighter mode instead of reporting a broken model.
 */
export class BackgroundRemovalCapacityError extends Error {
  readonly code = 'insufficient-memory' as const;
  readonly method: string;

  constructor(method: string) {
    const label =
      method === 'ai-quality' ? 'High-quality background removal' : 'AI background removal';
    super(
      `${label} does not fit this device's shared local-AI memory budget. Try Auto cutout, or Fast cutout and refine the mask by hand.`,
    );
    this.name = 'BackgroundRemovalCapacityError';
    this.method = method;
  }
}

/**
 * Ledger allowance for one background-removal model.
 *
 * The ledger tracks *conservative* reservations for co-resident local work; it
 * is not the fit decision. Whether a model actually fits is decided by the
 * per-operation gates that already exist: `preflightBrowserSourceMemory` (which
 * compares the model's measured peak against the WASM/runtime budget) and the
 * native OS/cgroup preflight, which measures free memory immediately before
 * session checkout. Charging the full measured peak here as well would double
 * count a figure the platform has already verified.
 *
 * Deriving from the catalog keeps this in step with the model that will load:
 * weights plus a fixed runtime arena, floored at the historical 128 MiB so a
 * small bundled model is never under-reserved.
 */
function modelAllowanceBytes(method: string, modelId: string | undefined): number {
  const resolvedId = modelId ?? workerModelIdForMethod(method as RemovalMethod);
  const entry = resolvedId ? getModelById(resolvedId) : undefined;
  const weightsBytes = entry?.sizeBytes ?? 128 * 1024 * 1024;
  return Math.max(128 * 1024 * 1024, weightsBytes * 2);
}

function reservationFor(imageData: ImageData, options: BackgroundRemovalOptions): number {
  return estimateInferenceReservation({
    width: imageData.width,
    height: imageData.height,
    modelBytes: modelAllowanceBytes(options.method, options.modelId),
  });
}

async function acquireRemovalLease(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<InferenceLease> {
  try {
    return await getInferenceAdmission().acquire({
      kind: 'background-removal',
      reservationBytes: reservationFor(imageData, options),
      signal,
      label: `background removal (${options.method})`,
    });
  } catch (error) {
    if (!(error instanceof InferenceAdmissionError) || error.code !== 'insufficient-memory') {
      throw error;
    }
    throw new BackgroundRemovalCapacityError(options.method);
  }
}

export async function dispatchBackgroundRemoval(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (signal?.aborted) {
    throw new Error('cancelled');
  }

  if (options.method === 'quick') {
    return removeBackgroundHeuristic(imageData, options);
  }

  let lease: InferenceLease;
  try {
    lease = await acquireRemovalLease(imageData, options, signal);
  } catch (error) {
    // A capacity refusal happens before any provider runs, so the same
    // reduced-quality fallback that handles provider failure applies here too.
    // An explicit model request is honoured exactly and never substituted.
    if (error instanceof BackgroundRemovalCapacityError && !options.modelId) {
      if (options.method === 'ai-quality') {
        console.warn(
          '[bg-removal] shared memory budget refused ai-quality; falling back to ai-balanced (u2netp)',
        );
        const reduced = await dispatchBackgroundRemoval(
          imageData,
          { ...options, method: 'ai-balanced' },
          signal,
        );
        return { ...reduced, method: 'ai-balanced' };
      }
    }
    throw error;
  }

  try {
    return await dispatchBackgroundRemovalAdmitted(imageData, options, signal);
  } finally {
    lease.release();
  }
}

async function dispatchBackgroundRemovalAdmitted(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  // Every availability check, provider, and reduced-quality fallback shares
  // one budget. A stalled runtime cannot multiply the wait by chain length.
  const deadline =
    performance.now() +
    (options.method === 'ai-quality' ? QUALITY_PROVIDER_TIMEOUT : BALANCED_PROVIDER_TIMEOUT);
  const result = await tryProviderChain(imageData, options, deadline, signal);
  if (result) return result;

  // Failed at the requested quality. If this was ai-quality, automatically
  // fall back to ai-balanced (u2netp) — the bundled model is always safe
  // and doesn't risk crashing on WASM memory limits. An explicit model
  // request must never be silently substituted, so it skips this fallback.
  if (options.method === 'ai-quality' && !options.modelId) {
    console.warn(
      '[bg-removal] ai-quality failed through all providers; falling back to ai-balanced (u2netp)',
    );

    const fallbackOptions: BackgroundRemovalOptions = {
      ...options,
      method: 'ai-balanced',
    };

    const fallbackResult = await tryProviderChain(imageData, fallbackOptions, deadline, signal);
    if (fallbackResult) {
      return {
        ...fallbackResult,
        method: 'ai-balanced',
      };
    }

    throw new Error(
      'AI background removal failed in all quality modes. Switch to Quick mode or try again later.',
    );
  }

  if (options.modelId) {
    throw new Error(
      `The requested local model (${options.modelId}) could not run on this device. ` +
        'Choose another quality level, or manage local models in Settings, Offline Models.',
    );
  }

  if (options.method === 'portrait') {
    throw new Error(
      'Portrait matting (MODNet) could not run in this browser session. Install the 26 MB ' +
        'MODNet model from this panel, or use Auto/High quality segmentation with manual edge refinement.',
    );
  }

  // For ai-balanced that failed, give a clear error.
  throw new Error(
    'AI background removal is unavailable. The bundled model (u2netp) could not run. Try Fast mode for a simple background, or manage local models in Settings, Offline Models.',
  );
}
