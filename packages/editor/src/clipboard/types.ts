/** Clipboard payload, snapshot, outcome, and transfer-request types. */

import type { DepthMapResource } from '@varve/engine';
import type {
  EmbeddingRights,
  FontEmbeddingPolicy,
  FontReference,
  FontSourceKind,
} from '@varve/engine/font';
import type {
  Document,
  DocumentAsset,
  DocumentIconAsset,
  LayoutGrid,
  MockupTemplateAsset,
  RasterMaskAsset,
  SceneNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import type { VARVE_CLIPBOARD_FORMAT, VARVE_CLIPBOARD_VERSION } from './mime';

export interface ClipboardData {
  /** Versioned fragment envelope. Absent only on legacy pre-envelope copies. */
  format?: typeof VARVE_CLIPBOARD_FORMAT;
  version?: 1 | 2 | 3 | 4 | typeof VARVE_CLIPBOARD_VERSION;
  /** Source document identity, used to distinguish in-document paste from a foreign paste. */
  sourceDocumentId?: string;
  /** Active source page, so same-document paste can avoid reusing pose across pages. */
  sourcePageId?: string;
  nodes: SceneNode[];
  /** Original selected roots, in user selection order. */
  rootIds?: string[];
  /**
   * Node ids that support the roots but must not become visible paste roots.
   * These are explicit in v2; older payloads infer them from reachability.
   */
  dependencyIds?: string[];
  /** Accepted depth resources referenced by the copied mask/effect closure. */
  depthMaps?: Record<string, DepthMapResource>;
  /** Font metadata and permitted local bytes required by this fragment. */
  fontManifest?: Document['fontManifest'];
  fontDependencies?: ClipboardFontDependency[];
  rasterMaskAssets?: Record<string, RasterMaskAsset>;
  assets?: Record<string, DocumentAsset>;
  iconAssets?: Record<string, DocumentIconAsset>;
  mockupTemplates?: Record<string, MockupTemplateAsset>;
  /** Generative edit records whose source/result nodes are in this fragment. */
  generativeEdits?: NonNullable<Document['generativeEdits']>;
  components?: Document['components'];
  styles?: Document['styles'];
  paints?: Document['paints'];
  patternDefinitions?: Document['patternDefinitions'];
  variableStore?: Document['variableStore'];
  interactions?: Document['interactions'];
  timelines?: Document['timelines'];
  stories?: Document['stories'];
  motionExtensions?: Document['motionExtensions'];
  motionPresets?: Document['motionPresets'];
  /**
   * Placed-world transform of each copied selection root, keyed by the
   * node's ORIGINAL id. Optional and forward-compatible: clipboard payloads
   * without it (old copies, foreign writers) do not claim a destination-
   * independent world pose and are placed using the fallback center policy.
   *
   * When present, paste converts through world space:
   *   newLocal = targetParentWorld⁻¹ · anchor
   * so a child copied from inside artboard A lands at the same WORLD pose
   * after pasting into artboard B (or at the document top level) instead of
   * being reinterpreted in the destination's local frame. The source document
   * document and source page identity determine whether this pose belongs to
   * the destination page; foreign, cross-page, and legacy page payloads use
   * destination placement instead of reusing an unrelated page coordinate.
   */
  worldAnchor?: Record<string, Affine>;
  /** v3: only owners present in the copied fragment are included. */
  frameGuideLayouts?: Record<string, LayoutGrid[]>;
}
export interface ClipboardFontDependency {
  family: string;
  fontReference?: FontReference;
  postScriptName?: string;
  requestedWeight?: number;
  requestedStyle?: string;
  source?: FontSourceKind;
  embeddingRights?: EmbeddingRights;
  embeddingPolicy?: FontEmbeddingPolicy;
  /** `embedded` means the original bytes are present in dataBase64. */
  status: 'embedded' | 'metadata-only' | 'missing' | 'restricted';
  dataBase64?: string;
}
/** Immutable selection and geometry snapshot used by delayed exports. */
export interface ClipboardSelectionSnapshot {
  document: Document;
  nodes: readonly SceneNode[];
  activeId: string;
  revision: number;
  selectionRevision: number;
  worldTransforms?: Readonly<Record<string, Affine>>;
}
export interface ClipboardImportItem {
  data: string | Uint8Array;
  mimeType: string;
  name: string;
}
export interface UnifiedClipboardResult {
  varveData: ClipboardData | null;
  importItems: ClipboardImportItem[];
  /** Plain text that is not an SVG. Text editors remain the native owner. */
  plainText?: string;
  /** Bounded HTML snapshot for the editable rich-text importer. */
  htmlText?: string;
}
export type TransferIntent = 'paste' | 'copy' | 'cut' | 'import' | 'drop';
export interface TransferRequest {
  readonly operationId: string;
  readonly gestureId: string;
  readonly intent: TransferIntent;
  readonly sessionId?: string;
  readonly createdAt: number;
}
export type ClipboardRequest = TransferRequest;
export interface ClipboardCapabilities {
  readonly text: boolean;
  readonly html: boolean;
  readonly raster: boolean;
  readonly customMime: boolean;
  readonly fileTransfer: boolean;
  readonly permission: 'granted' | 'denied' | 'unknown';
}
export interface ClipboardSnapshot {
  readonly request: TransferRequest;
  readonly capturedAt: number;
  readonly capabilities: ClipboardCapabilities;
  readonly orderedItems: readonly string[];
  readonly alternatives: readonly string[];
}
export interface TransferOutcome {
  readonly request: TransferRequest;
  readonly status: 'committed' | 'empty' | 'failed' | 'cancelled' | 'superseded';
  readonly committedRoots: readonly string[];
  readonly warnings: readonly string[];
  readonly capabilities?: ClipboardCapabilities;
}
export type ClipboardWriteOutcome =
  | { status: 'editable'; mimeTypes: string[] }
  | { status: 'text-only'; reason: 'editable-format-unavailable' }
  | {
      status: 'failed';
      reason: 'clipboard-unavailable' | 'permission-denied' | 'write-failed';
    };
