/**
 * Runtime resolver — maps a (workflow, quality mode, image stats, installed
 * models) tuple to a concrete execution plan: which model, at what
 * resolution, on which provider, with what tiling strategy.
 *
 * The resolver stores user *intent* (quality mode), not a hardware-bound
 * model ID. Explicit modes require their matching installed model; only
 * Automatic may select an alternative. A missing artifact names its recovery.
 *
 * Quality modes map to verified runtime differences:
 *   - fast:        tiny model, 256px working image
 *   - balanced:    default model, 512px working image
 *   - quality:     default model, up to 1024px working image
 *   - automatic:   prefers default, otherwise tiny
 *
 * Both graphs use their fixed square input. The dispatcher reconstructs chroma
 * at the original source size with source luminance; it does not run tiles.
 * Native/browser execution is owned by the shared inference host and returned
 * provenance, not inferred from this resolution preference.
 */

import type { ColorizationModelConfig, ImageStats, QualityMode, RuntimeResolution } from './types';

export const DD_COLOR_MODELS: Record<string, ColorizationModelConfig> = {
  'ddcolor-tiny': {
    modelId: 'ddcolor-tiny',
    inputSize: 256,
    outputChannels: 2,
    preferredProvider: 'cpu',
  },
  ddcolor: {
    modelId: 'ddcolor',
    inputSize: 512,
    outputChannels: 2,
    preferredProvider: 'any',
  },
};

/** Ordered candidates shared by installation checks and execution. Only
 * Automatic accepts a different variant from the mode's explicit model. */
export function getDdColorModelCandidates(qualityMode: QualityMode): readonly string[] {
  if (qualityMode === 'fast') return ['ddcolor-tiny'];
  if (qualityMode === 'automatic') return ['ddcolor', 'ddcolor-tiny'];
  return ['ddcolor'];
}

export function resolveRuntime(
  workflow: string,
  qualityMode: QualityMode,
  stats: ImageStats,
  installedModels: string[],
): RuntimeResolution {
  if (workflow !== 'photo-colorize') {
    throw new Error(`DDColor runtime does not support workflow: ${workflow}`);
  }
  const longest = Math.max(stats.width, stats.height);
  const hasDefault = installedModels.includes('ddcolor');
  if (installedModels.length === 0) {
    throw new Error('No verified DDColor model is installed');
  }

  const modelId = getDdColorModelCandidates(qualityMode).find((id) => installedModels.includes(id));
  if (!modelId) {
    throw new Error(
      qualityMode === 'fast'
        ? 'Fast requires DDColor Tiny. Download it in Settings > Offline Models, then retry.'
        : 'This mode requires DDColor. Download it in Settings > Offline Models, then retry, or choose Fast for DDColor Tiny.',
    );
  }
  let maxDimension: number;

  switch (qualityMode) {
    case 'fast':
      maxDimension = 256;
      break;
    case 'quality':
    case 'balanced':
      maxDimension = qualityMode === 'quality' ? 1024 : 512;
      break;
    default: {
      const preferQuality = longest <= 2048 && hasDefault;
      maxDimension = preferQuality ? 1024 : 512;
      break;
    }
  }

  return {
    modelId,
    maxDimension,
    provider: selectProvider(modelId, qualityMode),
    tiled: false,
    tileSize: 512,
    tileOverlap: 64,
  };
}

function selectProvider(modelId: string, qualityMode: QualityMode): RuntimeResolution['provider'] {
  if (qualityMode === 'fast') return 'wasm';
  const config = DD_COLOR_MODELS[modelId];
  if (config?.preferredProvider === 'cpu') return 'wasm';
  return 'cpu';
}
