import type { Affine, PathPoint } from '@varve/engine';
import type { NodeId } from './ids';

// ── Mask types ──────────────────────────────────────────────────────────────

/**
 * Mask type determines how the mask source node controls visibility:
 * - 'clip': the source node's vector outline clips content (boolean, hard edge)
 * - 'alpha': the source node's alpha channel controls content opacity
 * - 'luminance': the source node's luminance (perceived brightness) controls
 *   content opacity. Black = transparent, white = opaque, following the SVG
 *   mask luminance formula: L = 0.2126*R + 0.7152*G + 0.0722*B (in linear RGB),
 *   multiplied by the source alpha.
 */
export type MaskType = 'clip' | 'alpha' | 'luminance';

/** Fill rule for clip masks and vector masks. */
export type MaskFillRule = 'nonzero' | 'evenodd';

/**
 * Independent vector mask data.
 * When set on a Mask, the mask geometry comes from this path data
 * rather than from a child node. The mask is resolution-independent
 * and remains editable via the Pen/Pencil tools or NodeEditTool.
 *
 * A vector mask can co-exist with a sourceNodeId reference; when both
 * are present, the vector mask defines the clipping geometry and the
 * sourceNodeId provides visual content (if hideMaskSource is false).
 */
export interface VectorMaskData {
  /** Control points in mask-local coordinates. */
  points: PathPoint[];
  /** Whether the last point connects back to the first. */
  closed: boolean;
  /** Fill rule for determining interior vs exterior. */
  fillRule: MaskFillRule;
}

/** Reproducibility metadata for an automatically generated subject mask. */
export interface BackgroundRemovalProvenance {
  method: 'quick' | 'ai-balanced' | 'ai-quality' | 'portrait';
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: 'typescript' | 'wasm' | 'webgl' | 'webgpu' | 'native-cpu' | 'native-accelerated';
  generatedAt: number;
  /** Raw provider ranking score, when the result came from prompted selection. */
  score?: number;
  /** Meaning of `score`; it is not a probability of user intent. */
  scoreSource?: 'predicted-iou' | 'stability' | 'heuristic' | 'model-iou' | 'activation-heuristic';
  confidence?: number;
  /**
   * Edge feather applied when the mask was generated (0-1 scale, provider
   * parameter). Recorded so the committed result is reproducible and the
   * panel can restore the setting that produced it.
   */
  feather?: number;
  /** Legacy edge-colour cleanup setting retained during v2.0 migration. */
  decontaminate?: boolean;
  /** How this raster mask entered the native asset table. */
  origin?: 'native' | 'legacy-background-removal-preview';
}

/** Immutable PNG payload stored once at the document level. */
export interface RasterMaskAsset {
  id: string;
  mimeType: 'image/png';
  dataUrl: string;
  width: number;
  height: number;
  byteLength: number;
  checksum?: string;
}

/**
 * Identity of the source pixels used to generate a raster mask.
 * `source-metadata` is deterministic but deliberately does not claim to be a
 * content digest. Callers with a verified digest should use `content-sha256`.
 */
export type RasterMaskSourceIdentity =
  | {
      kind: 'source-metadata';
      locator: string;
      pixelWidth?: number;
      pixelHeight?: number;
      revision: number;
    }
  | {
      kind: 'content-sha256';
      sha256: string;
      pixelWidth?: number;
      pixelHeight?: number;
      revision: number;
    };

/**
 * A persisted, re-editable depth-derived mask recipe.
 *
 * The resolved PNG remains the mask's fast/offline artifact (`assetId`), while
 * this record retains the accepted scalar resource and the user's intent. It
 * deliberately lives on the existing raster-mask union instead of creating a
 * second mask format or making a blur effect the owner of depth.
 */
export interface DepthMaskRecipe {
  schemaVersion: 1;
  depthMapId: string;
  sourceBinding: {
    nodeId: NodeId;
    fillAssetId?: string;
    processingRevision: number;
    coordinateSpace: 'source-image-pixels';
  };
  sourceIdentity: RasterMaskSourceIdentity;
  range: {
    near: number;
    far: number;
    nearTransition: number;
    farTransition: number;
  };
  invert: boolean;
  combine: 'replace' | 'intersect' | 'union' | 'subtract';
  /** Version of the shared depth-to-coverage kernel. */
  algorithmVersion: number;
  /** Optional independent correction layer; it never edits the depth map. */
  correction?: {
    assetId?: string;
    revision: number;
    target: 'coverage' | 'depth';
  };
}

/** Placement and source-revision metadata for a raster alpha mask. */
export interface RasterMaskData {
  assetId: string;
  /**
   * Pixel coordinate space of the mask payload:
   * - `source-image-pixels`: 1:1 with the masked image's source pixels
   *   (image-filled shape nodes).
   * - `legacy-preview-pixels`: v2.1 legacy background-removal previews.
   * - `container-local-pixels`: mask pixels map 1:1 to the frame's local
   *   units (0..w, 0..h), stretched with the container transform — the
   *   brush-painted layer-mask form for FrameNodes.
   * - `node-local-pixels`: mask pixels map 1:1 to a visual leaf node's local
   *   paint bounds (brush-painted layer masks).
   */
  coordinateSpace:
    | 'source-image-pixels'
    | 'legacy-preview-pixels'
    | 'container-local-pixels'
    | 'node-local-pixels';
  sourceIdentity: RasterMaskSourceIdentity;
  editRevision?: number;
  staleReason?: 'source-replaced' | 'source-changed' | 'legacy-preview-resolution';
  provenance?: BackgroundRemovalProvenance;
  /** Present when this resolved mask was created from a reusable depth map. */
  depthRecipe?: DepthMaskRecipe;
}

/** A live source reference for rendered alpha/luminance coverage. */
export type LiveMatteSource =
  | { kind: 'scene-node'; nodeId: NodeId }
  | { kind: 'vector'; vectorMask: VectorMaskData }
  | { kind: 'raster-asset'; assetId: string };

/**
 * A mask on a container node (FrameNode, GroupNode, or AdjustmentNode).
 *
 * The mask designates one of the container's children as the mask source.
 * A mask source acts as a child (renders in the container) BUT the container
 * may choose to hide the mask source's direct rendering and instead use its
 * outline/alpha/luminance to clip or modulate the other children.
 *
 * A mask may also carry self-contained vector path data (`vectorMask`) for
 * resolution-independent vector masks that don't depend on a child node.
 *
 * Architecture notes:
 * - Masks are non-destructive and re-editable.
 * - A mask source must be a direct child of the container (when sourceNodeId
 *   is set). Vector masks (via `vectorMask`) have no such constraint.
 * - A container may have at most one mask.
 * - Nested masks are supported via nested containers.
 * - The mask source can have effects, fills, strokes, and transforms;
 *   these all contribute to the mask's effective shape/alpha/luminance.
 * - When both `sourceNodeId` and `vectorMask` are set, `vectorMask` defines
 *   the clipping geometry and `sourceNodeId` provides optional visual content.
 *
 * Research basis: Figma mask model, Adobe Photoshop layer masks,
 * Affinity Designer pixel/vector masks, SVG <clipPath>/<mask> specs.
 */
interface MaskPresentation {
  /** How the mask source controls visibility of masked content. */
  type: MaskType;
  /** Id of the child node used as the mask source. Must be a child of the container. */
  /** Whether the mask is active. When false, the mask is ignored during rendering. */
  visible: boolean;
  /**
   * Fill rule for clip/vector masks. Nonzero by default (SVG default).
   * Used only when type === 'clip' or when vectorMask is set.
   */
  fillRule?: MaskFillRule;
  /**
   * When true, the mask effect is inverted:
   * - clip: content inside the clip region is hidden, outside is visible
   * - alpha/luminance: transparent regions become opaque and vice versa
   * (default: false)
   */
  inverted?: boolean;
  /**
   * Feather radius in world-space pixels. Softens the mask edge by
   * applying a Gaussian blur to the mask's alpha/luminance values
   * before compositing. (default: 0, no feather)
   */
  feather?: number;
  /**
   * Overall mask density/strength as a value between 0 and 1.
   * 0 = mask has no effect (full visibility), 1 = full mask effect.
   * Applied after inversion and feather. (default: 1)
   */
  density?: number;
  /**
   * When true (default), the mask transforms with the masked content.
   * When false, the mask has its own independent transform.
   * (default: true)
   */
  linked?: boolean;
  /**
   * Independent mask transform used when linked === false.
   * If linked or transform is undefined, the mask source's own transform
   * is used (which itself is relative to the container).
   */
  transform?: Affine;
  /**
   * When true, the mask source node is hidden from direct rendering
   * but still contributes to the mask effect.
   * Like Figma's "hide mask source" or Photoshop's mask thumbnail.
   * (default: false — mask source is rendered normally)
   */
  hideMaskSource?: boolean;
  /** External/live source for alpha or luminance mattes. */
  matteSource?: LiveMatteSource;
}

/**
 * Exactly one effective mask source is present. A vector mask may additionally
 * reference a child node as optional visual content; vectorMask remains the
 * sole geometry source in that form.
 */
export type Mask = MaskPresentation &
  (
    | { sourceNodeId: NodeId; vectorMask?: never; rasterMask?: never }
    | { vectorMask: VectorMaskData; sourceNodeId?: NodeId; rasterMask?: never }
    | { rasterMask: RasterMaskData; sourceNodeId?: never; vectorMask?: never }
    | { matteSource: LiveMatteSource; sourceNodeId?: never; vectorMask?: never; rasterMask?: never }
  );

/** Ownership-neutral parameters for a rendered coverage binding. */
export interface EffectMaskBinding {
  source: LiveMatteSource;
  type: 'alpha' | 'luminance' | 'clip';
  visible?: boolean;
  inverted?: boolean;
  density?: number;
  feather?: number;
  linked?: boolean;
  transform?: Affine;
  coordinateSpace: 'target-local' | 'world';
}

// ── Background Removal Types ─────────────────────────────────────────────────

export type BackgroundRemovalMethod = 'quick' | 'ai-balanced' | 'ai-quality' | 'portrait';

export interface BackgroundRemovalState {
  maskDataUrl: string;
  method: BackgroundRemovalMethod;
  confidence: number;
  appliedAt: number;
  feather?: number;
  decontaminate?: boolean;
}
