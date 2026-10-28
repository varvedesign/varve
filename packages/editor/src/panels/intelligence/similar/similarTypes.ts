import type { SimilaritySearchMode } from '@varve/engine/semanticSimilarity';
import { DINOV2_SMALL_IMAGE_MODEL, type EmbeddingVector } from '@varve/engine/semanticSimilarity';
import type { NodeId } from '@varve/scene';

/**
 * Image-to-image lane uses DINOv2-small (evidence-backed default: parity
 * verified, retrieval ≈ SigLIP, ~1.8x faster, 2.4x smaller). The
 * natural-language lane compares against SigLIP *image* embeddings, so
 * it keeps the SigLIP image encoder (separate space — see
 * EmbeddingVector compatibility guards in semanticSimilarity).
 */
export const EMBED_IMAGE_MODEL = DINOV2_SMALL_IMAGE_MODEL;
export const EMBED_IMAGE_MODEL_ID = EMBED_IMAGE_MODEL.id;
/** Bound how many document images get embedded per search — running
 * inference on an unbounded document could stall the UI for a long time. */
export const MAX_SIMILAR_CANDIDATES = 30;

export interface SimilarMatch {
  nodeId: NodeId;
  src: string;
  similarity: number;
  lane: SimilaritySearchMode;
}

/**
 * Deterministic test seam: E2E specs inject a mock embedder through
 * window.__varveSimilarityTest.mockEmbed to cover the populated-results
 * UI without running real inference. Production code never installs it.
 */
export interface WindowSimilarityTestHook {
  mockEmbed?: (src: string) => Promise<EmbeddingVector>;
}

declare global {
  interface Window {
    __varveSimilarityTest?: WindowSimilarityTestHook;
  }
}

export const MAX_SEMANTIC_SOURCE_DIMENSION = 2048;

export function loadImageToImageDataForAI(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(
        1,
        MAX_SEMANTIC_SOURCE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      // Make transparent assets deterministic: the embedding sees a neutral
      // matte rather than browser-dependent transparent-black pixels.
      ctx.fillStyle = 'rgb(128 128 128)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}
