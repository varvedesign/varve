import type { GenerativeEditResult } from '@varve/engine';
import type { SourceImageRegion } from '../generationRaster';

export interface GenerationRecord {
  sourceSignature: string;
  userMaskDataUrl: string;
  inferenceMaskDataUrl: string;
  userMaskWidth: number;
  userMaskHeight: number;
  userMaskBounds?: SourceImageRegion;
  inferenceMaskWidth: number;
  inferenceMaskHeight: number;
  inferenceMaskOffsetX: number;
  inferenceMaskOffsetY: number;
  contextDataUrl: string;
  contextWidth: number;
  contextHeight: number;
  outputFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  patchDataUrl: string;
  patchWidth: number;
  patchHeight: number;
  patchFrame?: SourceImageRegion;
  assetKind: 'full-output' | 'region-overlay';
  result: GenerativeEditResult;
  seed: number;
}

export type EditableSourceMask = {
  width: number;
  height: number;
  /** Decoded coverage for a newly supplied source-sized mask. */
  coverage?: Uint8Array;
  /** Persisted source mask retained as a lazy, bounded decode reference. */
  dataUrl?: string;
  bounds?: SourceImageRegion;
};

export interface DialogModeCapability {
  available: boolean;
  ready: boolean;
  prompt: boolean;
  variations: boolean;
  supportedParameters: readonly string[];
  limits: {
    maxWidth: number;
    maxHeight: number;
    maxVariations: number;
    maxSteps?: number;
  };
  reasonCode?: string;
  reason?: string;
}
