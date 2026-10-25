/**
 * Human-readable model information for the background-removal UI.
 *
 * Each entry documents what the user needs to know before selecting a mode:
 * disk size, estimated peak RAM during inference, quality tier, and any
 * backend requirements.
 */

export interface ModelInfo {
  /** UI label (short). */
  readonly label: string;
  /** UI description (sentence). */
  readonly description: string;
  /** Model file size on disk (bytes). */
  readonly diskSizeBytes: number;
  /** Optional working-memory estimate; absent when the evidence is unqualified. */
  readonly estimatedPeakRamBytes?: number;
  /** Human-readable peak memory string. */
  readonly peakRamDisplay: string;
  /**
   * Peak memory for native desktop execution (bytes), when it is measured and
   * differs from the browser figure. Optional so browser-only models keep one
   * honest number.
   */
  readonly nativeEstimatedPeakRamBytes?: number;
  /** Human-readable native peak memory string, with measurement provenance. */
  readonly nativePeakRamDisplay?: string;
  /** Human-readable disk size string. */
  readonly diskSizeDisplay: string;
  /** Quality tier label. */
  readonly quality: string;
  /** Whether a download is required (not bundled). */
  readonly requiresDownload: boolean;
  /** Whether GPU acceleration is recommended. */
  readonly gpuRecommended: boolean;
  /** Whether WASM-only is safe (known not to crash). */
  readonly wasmSafe: boolean;
}

export const QUICK_MODEL_INFO: ModelInfo = {
  label: 'Fast',
  description: 'Local CPU heuristic for simple backgrounds; review and refine the mask.',
  diskSizeBytes: 0,
  estimatedPeakRamBytes: 16_000_000,
  peakRamDisplay: 'Working memory depends on image size; no model is loaded.',
  diskSizeDisplay: '0 B (no model)',
  quality: 'Basic',
  requiresDownload: false,
  gpuRecommended: false,
  wasmSafe: true,
};

export const AI_BALANCED_MODEL_INFO: ModelInfo = {
  label: 'Auto',
  description: 'Auto uses IS-Net when installed, with bundled U²-Net Light as its fallback.',
  diskSizeBytes: 178_648_008,
  // The previous 1.3 GB sample measured retained RSS, not peak allocation.
  peakRamDisplay: 'Peak working memory has not yet been validated for this runtime.',
  diskSizeDisplay: '179 MB optional',
  quality: 'Very good',
  requiresDownload: true,
  gpuRecommended: true,
  wasmSafe: false,
};

export const AI_QUALITY_MODEL_INFO: ModelInfo = {
  label: 'High quality',
  description: 'BiRefNet Lite for hair, fur, and complex edges.',
  diskSizeBytes: 224_000_000,
  // The retracted 450 MB native sample was post-inference RSS. Historical
  // browser process RSS neither measures linear memory nor establishes Full's
  // requirements. Keep these out of the disclosure until qualified peak runs.
  peakRamDisplay:
    'Peak working memory has not yet been validated. Earlier desktop residency and browser process-memory samples were not peak requirements.',
  diskSizeDisplay: '224 MB',
  quality: 'Best',
  requiresDownload: true,
  gpuRecommended: false,
  wasmSafe: false,
};

/**
 * MODNet portrait matting. 26 MB download, runs a 512-edge dynamic-shape
 * graph; the measured Node CPU run on the portrait fixtures took ~0.4 s per
 * image, so the peak figure is an estimate for the WASM working set, not a
 * measured RSS. It is the only mode explicitly scoped to human portraits.
 */
export const PORTRAIT_MODEL_INFO: ModelInfo = {
  label: 'Portrait',
  description: 'MODNet portrait matting for people photos — soft hair and clothing edges.',
  diskSizeBytes: 25_888_640,
  estimatedPeakRamBytes: 400_000_000,
  peakRamDisplay: '~400 MB RAM (estimated)',
  diskSizeDisplay: '26 MB optional',
  quality: 'Portrait-specialist',
  requiresDownload: true,
  gpuRecommended: false,
  wasmSafe: true,
};

export const MODEL_INFO_MAP: Record<string, ModelInfo> = {
  quick: QUICK_MODEL_INFO,
  'ai-balanced': AI_BALANCED_MODEL_INFO,
  'ai-quality': AI_QUALITY_MODEL_INFO,
  portrait: PORTRAIT_MODEL_INFO,
};

export function getModelInfo(method: string): ModelInfo | undefined {
  return MODEL_INFO_MAP[method];
}
