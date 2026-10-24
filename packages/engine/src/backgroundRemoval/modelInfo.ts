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
  /** Estimated peak WASM heap + tensor memory during inference (bytes). */
  readonly estimatedPeakRamBytes: number;
  /** Human-readable peak memory string. */
  readonly peakRamDisplay: string;
  /**
   * Peak memory for native desktop execution (bytes), when it is measured and
   * differs from the browser figure. Optional so browser-only models keep one
   * honest number.
   */
  readonly nativeEstimatedPeakRamBytes?: number;
  /** Human-readable native peak memory string, e.g. "~450 MB". */
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
  description: 'Fast CPU heuristic — no AI model, works offline on every image.',
  diskSizeBytes: 0,
  estimatedPeakRamBytes: 16_000_000,
  peakRamDisplay: '~16 MB',
  diskSizeDisplay: '0 B (no model)',
  quality: 'Basic',
  requiresDownload: false,
  gpuRecommended: false,
  wasmSafe: true,
};

export const AI_BALANCED_MODEL_INFO: ModelInfo = {
  label: 'Auto',
  description: 'General-purpose local AI with automatic low-memory fallback.',
  diskSizeBytes: 178_648_008,
  // Measured retained RSS (native CPU, 2026-08-13 parity audit): ~1.3 GB.
  estimatedPeakRamBytes: 1_300_000_000,
  peakRamDisplay: '~1.3 GB RAM',
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
  // Browser/WASM boundary, not a working set: bare WASM deterministically
  // aborts at the wasm32 4 GiB address-space ceiling during session.run()
  // (~4027-4145 MB RSS; docs/audits/
  // background-removal-wasm-memory-hardening-2026-07-18.md). The static
  // 1024x1024 input cannot be downscaled to fit, so the gate must refuse it.
  estimatedPeakRamBytes: 4_100_000_000,
  peakRamDisplay: 'browser WASM needs ~4.1 GB (over its limit)',
  // Native measured peak: bgremove_bench on the bundled ORT CPU build with the
  // arena disabled reported 432 MiB peak RSS across a 12-image corpus
  // (2026-10-22).
  nativeEstimatedPeakRamBytes: 450_000_000,
  nativePeakRamDisplay: '~450 MB RAM on desktop',
  diskSizeDisplay: '224 MB',
  quality: 'Best',
  requiresDownload: true,
  gpuRecommended: true,
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
