import { getEnvironmentCapabilities, isWasmModelSafe } from './environmentCapabilities';
import { getModelLoaderReady } from './modelLoader';
import { getNativeBackgroundRemovalModelStatus } from './providers/tauriProvider';
import { type RemovalMethod, type WorkerModelId, workerModelIdForMethod } from './types';

/** Installation and runtime checks are separate facts. canAttempt is permission
 * to try this route, not proof of model execution or available working memory.
 * Dispatch and native preflight still recheck at execution time. */
export interface BackgroundRemovalReadiness {
  modelId: WorkerModelId | null;
  installed: boolean;
  canAttempt: boolean;
  runtime: string;
  summary: string;
  recovery: string | null;
  enhancedInstalled: boolean;
}

export async function getBackgroundRemovalReadiness(
  method: RemovalMethod,
  requestedModel?: WorkerModelId,
): Promise<BackgroundRemovalReadiness> {
  if (method === 'quick') {
    return {
      modelId: null,
      installed: true,
      canAttempt: true,
      runtime: 'Local CPU',
      summary: 'No model required',
      recovery: null,
      enhancedInstalled: false,
    };
  }
  const loader = await getModelLoaderReady();
  const caps = await getEnvironmentCapabilities();
  const enhancedInstalled =
    method === 'ai-balanced' && (await loader.isModelAvailable('isnet-general-use'));
  const modelId =
    requestedModel ?? (enhancedInstalled ? 'isnet-general-use' : workerModelIdForMethod(method)!);
  if (caps.isTauri) {
    const native = await getNativeBackgroundRemovalModelStatus(modelId);
    if (!native) {
      throw new Error(
        'Could not read native model status. Retry the model check; if it still fails, restart the desktop app.',
      );
    }
    return {
      modelId,
      installed: native.installed,
      canAttempt: native.installed && native.runtimeReady,
      runtime: native.runtimeReady ? 'Native CPU' : 'Native runtime unavailable',
      summary: !native.runtimeReady
        ? 'Native runtime unavailable'
        : native.installed
          ? 'Installed'
          : 'Download required',
      recovery: !native.runtimeReady
        ? 'Restart the desktop app. If the runtime remains unavailable, reinstall the app with its bundled inference runtime.'
        : native.installed
          ? null
          : 'Install this model in Offline Models or download it here.',
      enhancedInstalled,
    };
  }

  const installed = await loader.isModelAvailable(modelId);
  const wasmSafe = await isWasmModelSafe(modelId);
  // An adapter is only a candidate: the graph's operators may be unsupported.
  // Never promise GPU execution or equate detected acceleration with readiness.
  const cpuOnly = modelId === 'u2netp' || modelId === 'u2netp-int8';
  const accelerated = !cpuOnly && (caps.hasWebGPU || (caps.hasWebGL && !caps.isWebKitGTK));
  const supported = caps.hasWorker && (wasmSafe || accelerated);
  const runtime = accelerated ? 'Browser acceleration candidate' : 'Browser CPU';
  const summary = !supported
    ? 'Not supported by this browser session'
    : !installed
      ? 'Download required'
      : accelerated
        ? 'Installed; accelerator support checked on use'
        : 'Installed';
  return {
    modelId,
    installed,
    canAttempt: installed && supported,
    runtime,
    summary,
    recovery: !supported
      ? 'Use the desktop app for this model, or choose Fast to create a mask without a model.'
      : !installed
        ? 'Install this model in Offline Models or download it here.'
        : null,
    enhancedInstalled,
  };
}
