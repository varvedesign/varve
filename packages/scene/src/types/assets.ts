import type { DepthMapResource } from '@varve/engine';
import type { AnimatedAssetMetadata, RasterColorEncoding } from '@varve/shared';

/**
 * Where an asset's bytes live. Only 'embedded' ships today; 'linked' (an
 * external file resolved by path + fingerprint) is a deliberate future
 * addition — see docs/audits/smart-object-feasibility-audit.md. The record
 * shape below is designed so adding it later is a new `storage` value, not a
 * schema redesign.
 */
export type AssetStorageKind = 'embedded';

/**
 * EXIF orientation tag value (1-8) of a raster source. Kept as a local
 * literal union so the scene model does not depend on the engine's
 * metadata module; values are structurally identical.
 */
export type SourceExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * A colour profile stored once in `Document.iccProfiles` and referenced by
 * id from any number of `DocumentAsset.metadata.iccProfileId` entries, so
 * identical profiles are never duplicated per asset or per placement.
 */
export interface IccProfileEntry {
  /** Content-addressed id (`icc-<hash>`), stable for identical bytes. */
  id: string;
  /** Base64-encoded profile bytes (the canonical payload). */
  profileBase64: string;
  byteLength: number;
  /** Legacy sync content hash of `profileBase64`, retained for old document ids. */
  hash: string;
  /** SHA-256 fingerprint of the canonical profile payload. */
  fingerprint?: string;
  /** ASCII `desc` tag, when present and printable. */
  description?: string;
  /** ICC profile class signature (e.g. 'mntr' display class). */
  profileClass?: string;
  /** ICC colour space signature (e.g. 'RGB ', 'CMYK', 'GRAY', 'Lab '). */
  colorSpace?: string;
  /** ICC version, e.g. '4.3.0'. */
  version?: string;
  /** ICC header rendering intent field (0-3: perceptual/relative/saturation/absolute). */
  renderingIntent?: number;
}

/**
 * Normalized ingestion metadata attached to a `DocumentAsset`. Rendering
 * metadata (orientation, ICC status) is understood once here, not per fill.
 *
 * Decode invariant: browser decoders apply EXIF orientation, so the decoded
 * representation is orientation-normalized. `orientation` records the
 * stored tag so callers can compute displayed dimensions; it is never
 * re-applied to decoded pixels.
 */
export interface ImageSourceMetadata {
  /** Stored EXIF orientation tag; absent means no rotation (tag 1). */
  orientation?: SourceExifOrientation;
  /** Stored (pre-orientation) pixel dimensions of the source. */
  pixelWidth?: number;
  pixelHeight?: number;
  /** Reference into `Document.iccProfiles`. */
  iccProfileId?: string;
  /** Outcome of ICC extraction: valid, explicitly invalid, or absent. */
  iccStatus?: 'valid' | 'invalid' | 'none';
  /** ICC `desc` tag label (display only, never authoritative). */
  iccDescription?: string;
  /**
   * Canonical colour interpretation of the source pixels (v2.19+). Carries
   * primaries, transfer, precision, provenance and diagnostics. Older
   * documents (and profiles that predate metadata extraction) omit it; the
   * read-time fallback is `legacy-assumed-srgb`, never silently claimed as
   * embedded metadata.
   */
  colorEncoding?: RasterColorEncoding;
}

/**
 * A document-level, content-addressed asset (v2.6+).
 *
 * Generalizes the `RasterMaskAsset` pattern (immutable payload stored once,
 * referenced by id) from raster masks to image fills. Multiple `ImageFillData`
 * values across any number of nodes/paints can share one `DocumentAsset` via
 * `assetId`, so placing the same image on many layers stores the bytes once.
 *
 * `dataUrl` is the canonical payload for 'embedded' storage. Per-usage
 * placement (fit/x/y/scale/crop) is NOT stored here — it stays on
 * `ImageFillData`, so each usage can be cropped/positioned independently
 * while sharing the same source bytes.
 */
export interface DocumentAsset {
  id: string;
  storage: AssetStorageKind;
  mimeType: string;
  /** Present when storage === 'embedded'. */
  dataUrl: string;
  /** Displayed (orientation-normalized) pixel dimensions of the source. */
  naturalWidth: number;
  naturalHeight: number;
  byteLength: number;
  /** Content hash of `dataUrl`, used for create-time dedup. */
  hash: string;
  /**
   * Normalized ingestion metadata (EXIF orientation, ICC status, stored
   * pixel dimensions). Optional so documents saved before metadata
   * extraction existed round-trip unchanged.
   */
  metadata?: ImageSourceMetadata;
  /** Immutable source/recipe provenance for RAW and HDR-derived assets. */
  photoSource?: import('../photoSource').PhotoAssetProvenance;
  /**
   * Animated-media facts (v2.20+), probed from the container bytes for
   * animated GIF/APNG/WebP imports. The original encoded bytes stay
   * authoritative; decoded/composited frames are never serialized. Absent
   * for static images.
   */
  animated?: AnimatedAssetMetadata;
}

/**
 * Persisted continuous depth field. Kept separate from RasterMaskAsset:
 * masks express semantic coverage, while a depth map preserves scalar values
 * for effects and future range-based consumers.
 */
export type DepthMapAsset = DepthMapResource;

/**
 * Non-destructive upscale metadata stored on an image fill.
 *
 * When present, the fill's `assetId` references an upscaled asset while
 * `upscale.sourceAssetId` retains the original source for re-upscale or reset.
 */
export interface ImageFillUpscale {
  /** Source asset id before upscaling. */
  sourceAssetId: string;
  /** Upscaled output asset id currently displayed. */
  upscaleAssetId: string;
  /** User-facing mode and numeric scale. */
  mode: string;
  scale: number;
  /** AI model id when mode === 'ai-enhance'. */
  modelId?: string;
}

/**
 * Identifies a bounded generative result painted above an immutable source
 * image. The fill's crop/placement fields carry the source-pixel frame; this
 * marker lets Restore Original and repeated edits remove only the patch that
 * belongs to the accepted recipe.
 */
export interface GenerativeEditOverlay {
  editId: string;
  variationId: string;
  /** Source-image-pixel frame, independent of node-local image placement. */
  sourceFrame?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
