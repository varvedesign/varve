import { getModelLoaderReady } from '../backgroundRemoval/modelLoader';
import { getDdColorModelCandidates, resolveRuntime } from './runtimeResolver';
import type { ImageStats, QualityMode, RuntimeResolution } from './types';

export interface ResolvedDdColorRuntime extends RuntimeResolution {
  /** A verified bundled/downloaded/reachable model path from ModelLoader. */
  modelPath: string;
  /** Models confirmed usable while resolving this request. */
  installedModels: string[];
}

/**
 * Resolve a DDColor model through the same integrity-aware loader used by the
 * rest of the application. A catalog row or release URL alone is not enough
 * to execute inference.
 */
export async function resolveDdColorRuntime(
  qualityMode: QualityMode,
  stats: ImageStats,
  signal?: AbortSignal,
): Promise<ResolvedDdColorRuntime> {
  const loader = await getModelLoaderReady(signal);
  const installedModels: string[] = [];
  const candidates = getDdColorModelCandidates(qualityMode);
  for (const modelId of candidates) {
    const available = await loader.isModelAvailable(modelId, signal);
    signal?.throwIfAborted();
    if (available) {
      installedModels.push(modelId);
      break;
    }
  }

  if (installedModels.length === 0) {
    throw new Error(
      `No verified model for this quality mode is installed. Download ${candidates.map((id) => (id === 'ddcolor-tiny' ? 'DDColor Tiny' : 'DDColor')).join(' or ')} in Settings > Offline Models, then retry.`,
    );
  }

  const resolution = resolveRuntime('photo-colorize', qualityMode, stats, installedModels);
  const modelPath = await loader.getModelPath(resolution.modelId, signal);
  signal?.throwIfAborted();
  if (!modelPath) {
    throw new Error(
      `DDColor model ${resolution.modelId} is unavailable or failed integrity verification. Re-download it in Settings > Offline Models.`,
    );
  }

  return { ...resolution, modelPath, installedModels };
}
