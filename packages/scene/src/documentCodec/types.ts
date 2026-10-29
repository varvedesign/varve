import type { Document } from '../document';
import type { NodeId, SceneNode } from '../types';

export interface DocumentCodecWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export type DocumentDecodeResult =
  | { ok: true; document: Document; warnings: DocumentCodecWarning[] }
  | { ok: false; warnings: DocumentCodecWarning[]; error: string };

export interface DocumentNormalizeResult {
  document: Document;
  warnings: DocumentCodecWarning[];
}

export interface DocumentClosure {
  nodeIds: Set<NodeId>;
  nodes: Record<NodeId, SceneNode>;
  /** Exact font metadata required by the copied nodes and their styles. */
  fontManifest?: Document['fontManifest'];
  /** Component definitions whose instance or master is in the closure. */
  components?: Document['components'];
  /** Reusable styles referenced by closure nodes. */
  styles?: Document['styles'];
  /** Reusable paints referenced by closure nodes. */
  paints?: Document['paints'];
  /** Reusable pattern definitions referenced by closure fills. */
  patternDefinitions?: Document['patternDefinitions'];
  /** Variable bindings and their referenced aliases. */
  variableStore?: Document['variableStore'];
  /** Prototype interactions owned by closure nodes. */
  interactions?: Document['interactions'];
  /** Motion timelines/tracks targeting closure nodes. */
  timelines?: Document['timelines'];
  /** Linked text stories referenced by closure text frames. */
  stories?: Document['stories'];
  motionExtensions?: Document['motionExtensions'];
  motionPresets?: Document['motionPresets'];
  rasterMaskAssets?: Document['rasterMaskAssets'];
  /** Image assets (v2.6+) referenced by the closure's nodes — see ./assets.ts. */
  assets?: Document['assets'];
  /** Icon assets referenced by the closure's nodes — see ./iconAsset.ts. */
  iconAssets?: Document['iconAssets'];
  /** Accepted scalar depth resources referenced by effects or mask recipes. */
  depthMaps?: Document['depthMaps'];
  /** Mockup template assets referenced by the closure's nodes (v2.16+). */
  mockupTemplates?: Document['mockupTemplates'];
  /** Generative recipes owned by a node in the closure, including candidates. */
  generativeEdits?: Document['generativeEdits'];
}
