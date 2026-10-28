import type { MediaFillSettings, PatternArrangement } from '@varve/shared';
import type { ManagedColor } from '../colorManagement';
import type { BlendMode, GradientFill } from './appearance';
import type { GenerativeEditOverlay, ImageFillUpscale } from './assets';
import type { NodeId } from './ids';
import type { SceneNode } from './nodes/union';

/** How an image fill is sized relative to the node bounds. */
export type ImageFit = 'fill' | 'fit' | 'stretch' | 'tile' | 'crop';

/**
 * Non-destructive crop window in source-pixel coordinates.
 *
 * Defines the visible region of the source image. Pixels outside this
 * rectangle are hidden but preserved — the crop can be re-edited, reset,
 * or removed without losing source data. When undefined, the entire source
 * image is visible.
 *
 * Coordinates are in the source image's natural pixel space (0,0 = top-left
 * of the full decoded image, before any EXIF rotation is applied by the
 * renderer).
 */
export interface ImageCropRect {
  /** X offset from source image left edge, in source pixels. */
  x: number;
  /** Y offset from source image top edge, in source pixels. */
  y: number;
  /** Width of the crop window in source pixels. */
  w: number;
  /** Height of the crop window in source pixels. */
  h: number;
}

export interface ImageFillData {
  /**
   * Image source as a data URL.
   *
   * When `assetId` is set, this field is a materialized cache of
   * `Document.assets[assetId].dataUrl` — always kept in sync in-memory so
   * every existing reader keeps working unchanged, but treated as derived,
   * not authoritative: the canonical bytes live once in `Document.assets`,
   * and `src` is stripped from serialized output to avoid duplicating them
   * per-usage on disk (see `stripEmbeddedAssetPayloads` in version.ts).
   *
   * When `assetId` is unset, `src` is authoritative on its own (legacy
   * fills predating the asset system, or a plain file path).
   */
  src: string;
  /** Reference into `Document.assets`. See doc comment on `src` above. */
  assetId?: string;
  /** Source/derived relationship for RAW development or HDR renditions. */
  photoSource?: import('../photoSource').PhotoSourceBinding;
  fit: ImageFit;
  /** Position offset in px (relative to node top-left) when fit !== 'fill'/'stretch'. */
  x: number;
  y: number;
  /** Scale multiplier (1 = natural). Used for 'tile' and 'fit'. */
  scale: number;
  /** Natural image width in pixels. When omitted, the node bounds width is used. */
  imageWidth?: number;
  /** Natural image height in pixels. When omitted, the node bounds height is used. */
  imageHeight?: number;
  /**
   * Non-destructive crop window in source-pixel coordinates.
   *
   * Defines which rectangular region of the source image is visible. When
   * undefined, the entire source image is shown. The crop is stored on the
   * fill (not baked into node geometry) so it can be re-edited, reset, or
   * removed after save/reopen without losing source pixels.
   *
   * Coordinate space: (0,0) = top-left of the full decoded source image.
   * The crop rect must satisfy 0 ≤ x, 0 ≤ y, x + w ≤ imageWidth,
   * y + h ≤ imageHeight (enforced by validateImageCropRect).
   */
  crop?: ImageCropRect;
  /**
   * Rotation of the image content within the node, in degrees clockwise.
   * Applied to the source pixels before fit/placement math. Stored on the
   * fill so it is independent of the node's object-space transform.
   */
  rotation?: number;
  /** Horizontal flip of the image content. Applied before fit/placement. */
  flipH?: boolean;
  /** Vertical flip of the image content. Applied before fit/placement. */
  flipV?: boolean;
  /** Non-destructive upscale metadata. */
  upscale?: ImageFillUpscale;
  /** Bounded generative patch painted over the source fill. */
  generativeEditOverlay?: GenerativeEditOverlay;
  /**
   * Non-destructive four-corner (perspective) transform. When present, the
   * image fill is rendered through the engine's projective `warpedImage`
   * primitive; the quad maps the node-box rectangle onto a convex quad in
   * node-local space. The source pixels and crop are preserved.
   */
  perspective?: import('../imagePerspective').ImageFillPerspective;
  /**
   * Per-usage animated-media playback settings (v2.20+). Only present on
   * fills whose asset is animated; multiple usages of one asset may carry
   * independent playback settings.
   */
  media?: MediaFillSettings;
}

/**
 * A procedural pattern recipe (v2.32+).
 *
 * The recipe — not the generated bitmap — is the editable source of truth for a
 * procedural pattern, so it survives save/reopen, can be regenerated
 * deterministically from its seed, and never re-rolls on zoom, backend switch,
 * or export. `tileSrc` remains the derived data URL that the renderer consumes;
 * it is a cache, and the recipe is what the Inspector edits.
 */
export interface PatternGeneratorRecipe {
  /** Generator kind. Kept as a string so an unknown future kind round-trips. */
  type: string;
  tileWidth: number;
  tileHeight: number;
  color1: string;
  color2: string;
  seed?: number;
  angle?: number;
  density?: number;
  gap?: number;
}

/**
 * Repeat geometry stored on a reusable pattern definition. Fill instances may
 * override placement, while this record describes the source's authored
 * lattice. Cell dimensions are independent of the visible artwork bounds.
 */
export interface PatternRepeatDefinition {
  arrangement: PatternArrangement;
  gapX: number;
  gapY: number;
  /** Horizontal displacement of odd rows as a fraction of the column step. */
  rowShift: number;
  /** Vertical displacement of odd columns as a fraction of the row step. */
  columnShift?: number;
  mirrorX: boolean;
  mirrorY: boolean;
  originX: number;
  originY: number;
}

export interface PatternCellBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Editable source captured by a reusable pattern definition. */
export type PatternDefinitionSource =
  | {
      kind: 'vector';
      /** Root motif IDs in this private mini-scene. */
      rootIds: NodeId[];
      /** Copied nodes; edits to the original document artwork do not affect it. */
      nodes: Record<NodeId, SceneNode>;
      /** Content-addressed document resources referenced by the mini-scene. */
      assetIds: string[];
      styleIds: string[];
      componentIds: string[];
    }
  | {
      kind: 'raster';
      assetId: string;
      width: number;
      height: number;
      fileName?: string;
    }
  | {
      kind: 'procedural';
      recipe: PatternGeneratorRecipe;
    };

/**
 * Document-level, editable pattern. `previewSrc` is a derived render cache;
 * the vector mini-scene, raster asset, or procedural recipe remains the
 * source of truth. A cache is valid only when previewRevision matches revision.
 */
export interface PatternDefinition {
  id: string;
  name: string;
  revision: number;
  cell: PatternCellBounds;
  repeat: PatternRepeatDefinition;
  source: PatternDefinitionSource;
  /** Data URL cache used by current raster-oriented render paths. */
  previewSrc?: string;
  previewRevision?: number;
  /** Pattern definitions referenced by supported nested sources. */
  dependencyPatternIds?: string[];
}

export interface PatternFillData {
  /** Reference to a tile node id or a data URL of the tile pattern. */
  tileSrc: string;
  /** Shared editable source in Document.patternDefinitions, when present. */
  definitionId?: string;
  /**
   * Uniform gap in px between repetitions. Legacy single-axis value: used for
   * both axes when `gapX`/`gapY` are absent, so files written before v2.32
   * keep their exact spacing.
   */
  spacing: number;
  /** Rotation of the pattern field in degrees about the object centre. */
  rotation: number;
  /** Tile width in px override. When omitted, natural image width is used. */
  imageWidth?: number;
  /** Tile height in px override. When omitted, natural image height is used. */
  imageHeight?: number;
  /**
   * Horizontal gap between columns in px (v2.32+). Overrides `spacing` on the
   * x axis only, so a pattern can be looser across than down.
   */
  gapX?: number;
  /** Vertical gap between rows in px (v2.32+). Overrides `spacing` on y. */
  gapY?: number;
  /**
   * Repetition lattice (v2.32+): `grid`, `half-drop`, or `brick`. Absent means
   * `grid`, which is the pre-v2.32 behaviour.
   */
  arrangement?: PatternArrangement;
  /**
   * Row shift as a fraction of the column step (v2.32+). Overrides the
   * arrangement default; lets a document describe an arbitrary
   * staggered/hex-compatible lattice. See `@varve/shared` `patternRepeat`.
   */
  rowShift?: number;
  /** Vertical displacement of odd columns as a fraction of the row step. */
  columnShift?: number;
  /** Flip alternating columns horizontally (v2.32+). Default false. */
  mirrorX?: boolean;
  /** Flip alternating rows vertically (v2.32+). Default false. */
  mirrorY?: boolean;
  /**
   * Authored phase of the lattice in px, in the fill's pattern space
   * (v2.32+). Fractional and negative values are preserved.
   */
  offsetX?: number;
  offsetY?: number;
  /**
   * Logical width/height of the tile in px before any per-fill scaling
   * (v2.32+). This is the size the artwork was authored at; `imageWidth`
   * remains the raster placement size. Absent means it equals the raster size.
   */
  logicalWidth?: number;
  logicalHeight?: number;
  /** Shared document/page alignment; omitted keeps legacy object-relative phase. */
  alignment?: 'object' | 'document';
  /**
   * Procedural recipe this tile was generated from (v2.32+). When present the
   * recipe is the editable source; `tileSrc` holds the derived bitmap.
   */
  generator?: PatternGeneratorRecipe;
}

export type FillType = 'solid' | 'gradient' | 'image' | 'pattern';

export interface Fill {
  type: FillType;
  color?: ManagedColor;
  gradient?: GradientFill;
  image?: ImageFillData;
  pattern?: PatternFillData;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

/**
 * A first-class, independently-addressable Paint entity (v1.8+).
 *
 * A Paint wraps a Fill with identity (`id`, `name`) so it can be:
 * 1. Referenced by multiple nodes via `paintRefs[]` (paint reuse)
 * 2. Independently updated (changing one Paint updates all consumers)
 * 3. Promoted/demoted between inline `Fill[]` and shared `Paint` status
 *
 * Paint lives in the Document's `paints` map, alongside the existing
 * inline `fills[]` on each node. When a node has `paintRefs`, those paints
 * are resolved from `Document.paints` and used as the node's effective fill
 * stack — replacing the inline `fills`/`fill` for that node.
 *
 * Paint reuse is the key architectural change that decouples "what is painted"
 * from "where it is painted," letting the same image, gradient, or pattern
 * be used as the visual content of any number of nodes while being editable
 * in one place.
 */
export interface Paint {
  id: string;
  name: string;
  /** The fill content (solid, gradient, image, or pattern). */
  fill: Fill;
}

export function makePaint(id: string, name: string, fill: Fill): Paint {
  return { id, name, fill };
}
