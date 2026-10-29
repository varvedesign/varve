import {
  EFFICIENT_SAM_CAPABILITIES,
  EFFICIENT_SAM_DECODER_ID,
  EFFICIENT_SAM_ENCODER_ID,
  EFFICIENT_SAM_PROVIDER_ID,
  EFFICIENT_SAM_QUALITY_VALIDATION,
  getModelById,
  getRuntimeCapabilitiesSync,
  MOBILE_SAM_CAPABILITIES,
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  MOBILE_SAM_QUALITY_VALIDATION,
  PROMPTED_PROVIDER_LATENCY_PROXY,
  type PromptedProviderFact,
  type PromptedSelectionExecutionProvider,
  SAM2_CAPABILITIES,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
  SAM2_PROVIDER_ID,
  SAM2_QUALITY_VALIDATION,
} from '@varve/engine';
import type { NodeId } from '@varve/scene';

export const SAM2_SOFT_DEADLINE_MS = 15_000;
const EMBEDDING_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const EMBEDDING_CACHE_MIN_BYTES = 16 * 1024 * 1024;
const MOBILE_SAM_FALLBACK_PEAK_BYTES = 1_200_000_000;
const EFFICIENT_SAM_FALLBACK_PEAK_BYTES = 760_000_000;

export function promptedEncoderPeakBytes(encoderId: string): number {
  return (
    getModelById(encoderId)?.peakMemoryBytes ??
    (encoderId === MOBILE_SAM_ENCODER_ID
      ? MOBILE_SAM_FALLBACK_PEAK_BYTES
      : encoderId === EFFICIENT_SAM_ENCODER_ID
        ? EFFICIENT_SAM_FALLBACK_PEAK_BYTES
        : 600_000_000)
  );
}

/**
 * Keep embeddings proportional to the runtime's safe working budget. This is
 * a cache allowance, not a claim that the model fits; resource preflight still
 * decides whether a request may allocate its source and model buffers.
 */
export function embeddingCacheBudgetBytes(): number {
  const safePeakBytes = getRuntimeCapabilitiesSync().wasmSafePeakBytes;
  if (!Number.isFinite(safePeakBytes) || safePeakBytes <= 0) {
    return 128 * 1024 * 1024;
  }
  return Math.min(
    EMBEDDING_CACHE_MAX_BYTES,
    Math.max(EMBEDDING_CACHE_MIN_BYTES, Math.floor(safePeakBytes * 0.15)),
  );
}

export function promptedExecutionProvider(
  runtime: ReturnType<typeof getRuntimeCapabilitiesSync>,
): PromptedSelectionExecutionProvider {
  // A WebGPU-capable browser is not the same thing as a WebGPU-validated
  // graph. The currently pinned prompted artifacts are catalogued for WASM;
  // the inference worker also forces that provider for these model ids. Keep
  // the routing explanation truthful until a graph-specific WebGPU gate exists.
  void runtime;
  return 'wasm';
}

/**
 * Entry ceiling for the embedding cache. The documented policy bounds the
 * cache by bytes; the entry cap only exists as a hard safety ceiling. One
 * SAM2-Tiny embedding set is ~16 MiB (image_embed + two high-res feature
 * maps), so a fixed 2-entry cap would bind long before the byte budget and
 * silently downgrade warm refinement on capable hosts. Derive the ceiling
 * from the budget instead: the budget evicts, the cap only catches an
 * estimate gone wrong.
 */
export function embeddingCacheMaxEntries(budgetBytes: number): number {
  const SAM2_TINY_EMBEDDING_BYTES = 16 * 1024 * 1024;
  return Math.max(2, Math.min(8, Math.floor(budgetBytes / SAM2_TINY_EMBEDDING_BYTES)));
}

export function promptedProviderFacts(
  mobileInstalled: boolean,
  sam2Installed: boolean,
  efficientSamInstalled = false,
): PromptedProviderFact[] {
  const mobileLatency = PROMPTED_PROVIDER_LATENCY_PROXY[MOBILE_SAM_PROVIDER_ID];
  const sam2Latency = PROMPTED_PROVIDER_LATENCY_PROXY[SAM2_PROVIDER_ID];
  const efficientSamLatency = PROMPTED_PROVIDER_LATENCY_PROXY[EFFICIENT_SAM_PROVIDER_ID];
  return [
    {
      id: MOBILE_SAM_PROVIDER_ID,
      label: 'Faster prompted selection',
      encoderId: MOBILE_SAM_ENCODER_ID,
      decoderId: MOBILE_SAM_DECODER_ID,
      installed: mobileInstalled,
      workingSetBytes: promptedEncoderPeakBytes(MOBILE_SAM_ENCODER_ID),
      warmPromptP50Ms: mobileLatency?.p50Ms,
      warmPromptP95Ms: mobileLatency?.p95Ms,
      warmPromptP95Source: mobileLatency?.source ?? 'estimated',
      // Real-photo browser validation found a recoverable but important
      // ambiguity: a boundary click can receive a high predicted-IoU score
      // for an expansive background patch. Keep MobileSAM explicit until a
      // broader browser-quality corpus proves that automatic promotion is safe.
      experimental: true,
      capabilities: MOBILE_SAM_CAPABILITIES,
      validation: MOBILE_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
    {
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      installed: sam2Installed,
      workingSetBytes: getModelById(SAM2_ENCODER_ID)?.peakMemoryBytes ?? 700_000_000,
      warmPromptP50Ms: sam2Latency?.p50Ms,
      warmPromptP95Ms: sam2Latency?.p95Ms,
      warmPromptP95Source: sam2Latency?.source ?? 'estimated',
      capabilities: SAM2_CAPABILITIES,
      validation: SAM2_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
    {
      id: EFFICIENT_SAM_PROVIDER_ID,
      label: 'Lightweight experimental selection',
      encoderId: EFFICIENT_SAM_ENCODER_ID,
      decoderId: EFFICIENT_SAM_DECODER_ID,
      installed: efficientSamInstalled,
      workingSetBytes: promptedEncoderPeakBytes(EFFICIENT_SAM_ENCODER_ID),
      warmPromptP50Ms: efficientSamLatency?.p50Ms,
      warmPromptP95Ms: efficientSamLatency?.p95Ms,
      warmPromptP95Source: efficientSamLatency?.source ?? 'estimated',
      // The 2026-09-14 A/B measured quality equivalent to MobileSAM with a
      // larger peak working set and no mask-prompt input. It stays
      // explicit-only: automatic routing must never pick it, and selecting it
      // says so in the UI.
      experimental: true,
      capabilities: EFFICIENT_SAM_CAPABILITIES,
      validation: EFFICIENT_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
  ];
}

export function promptedRequiredCapabilities(prompts: {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
}): { pointPrompts: boolean; boxPrompts: boolean } {
  return {
    pointPrompts: (prompts.points?.length ?? 0) > 0,
    boxPrompts: prompts.box != null,
  };
}

export function promptedEmbeddingCacheKey({
  documentId,
  nodeId,
  src,
  width,
  height,
  sourceFingerprint,
  providerId,
  encoderId,
  encoderArtifact,
  decoderId,
  decoderArtifact,
}: {
  documentId: string;
  nodeId: NodeId;
  src: string;
  width: number;
  height: number;
  sourceFingerprint: string;
  providerId: string;
  encoderId: string;
  encoderArtifact: string;
  decoderId: string;
  decoderArtifact: string;
}): string {
  return [
    documentId,
    nodeId,
    src,
    width,
    height,
    sourceFingerprint,
    providerId,
    encoderId,
    encoderArtifact,
    decoderId,
    decoderArtifact,
    providerId === MOBILE_SAM_PROVIDER_ID
      ? 'mobilesam-acly-v1'
      : providerId === EFFICIENT_SAM_PROVIDER_ID
        ? 'efficientsam-ti-yunyangx-v1'
        : 'sam2-v1',
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}
