import type { Affine, Shape } from '@varve/engine';
import type { Effect, Stroke } from '../appearance';
import type { BackgroundRemovalState } from '../masks';
import type { NodeBase } from './base';
import type { LiveTraceState } from './groups';

/** Optional authoring metadata for an image shape used as a concept reference. */
export interface ConceptArtReferenceMetadata {
  /** Portable display name only; never store the original filesystem path. */
  sourceFileName?: string;
  /** References stay out of sampling unless an artist explicitly opts in. */
  includeInSampling: boolean;
  /** References stay out of artwork exports unless an artist explicitly opts in. */
  includeInExport: boolean;
}

/** Normalize untrusted reference metadata while keeping source paths private. */
export function normalizeConceptArtReferenceMetadata(
  value: unknown,
): ConceptArtReferenceMetadata | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const candidate = typeof raw.sourceFileName === 'string' ? raw.sourceFileName : '';
  const sourceFileName = candidate
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)
    ?.split('')
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
    })
    .join('')
    .trim()
    .slice(0, 255);
  return {
    ...(sourceFileName ? { sourceFileName } : {}),
    includeInSampling: raw.includeInSampling === true,
    includeInExport: raw.includeInExport === true,
  };
}

export interface ShapeNode extends NodeBase {
  kind: 'shape';
  /** Geometry in local coordinates. When `shapeless` is true, geometry is
   *  derived from the node's paint (e.g. image natural dimensions) and this
   *  field may still hold a fallback/sentinel rect for backward compat. */
  shape: Shape;
  /**
   * V1.8+: When true, this node's geometry is derived from its paint rather
   * than from the explicit `shape` field. For an image paint, the geometry is
   * the image's natural dimensions. For solid/gradient paints, it's a 100×100
   * default rect.
   *
   * This is the mechanism that makes images first-class objects: a shapeless
   * ShapeNode with an image paint IS an image — its bounds come from the image
   * content, not from a host shape that clips it. The node still supports all
   * ShapeNode features (transform, effects, strokes, blend modes, masks).
   *
   * Backward compatible: existing nodes always have shapeless=false/undefined.
   */
  shapeless?: boolean;
  transform: Affine;
  /** F6: stacked strokes. */
  strokes: Stroke[];
  /** F6: stacked effects (shadows, blurs). */
  effects: Effect[];
  /** Uniform or per-corner radius for rect-anchored shapes. */
  cornerRadius?: number | [number, number, number, number];
  /** Corner smoothing percentage (0-100), Sketch-style continuous corners. */
  cornerSmoothing?: number;
  /** Background removal mask applied to this shape's image fill. */
  backgroundRemoval?: BackgroundRemovalState;
  /** Live trace state for nondestructive raster-to-vector workflow. */
  liveTrace?: LiveTraceState;
  /** Accepted non-destructive generative edit that produced this raster. */
  generativeEditId?: string;
  /** Present only when this image-filled shape is authored as a local reference. */
  conceptArtReference?: ConceptArtReferenceMetadata;
}
