import type { Affine as EngineAffine, SceneNode as EngineSceneNode } from '@varve/engine';
import { type Affine, decomposeAffineFull, multiplyAffine, tryInvertAffine } from '@varve/shared';

/**
 * Morph correspondence.
 *
 * Contract (grown from real cross-tool failure reports):
 * - Objects match ONLY on an exact, non-empty name that is unique among
 *   matchable candidates on each side. Identical text content alone never
 *   creates a match, and a name duplicated within one slide matches nothing.
 * - Kind must agree: text-to-text, image-to-image, and shape-to-shape with
 *   the same shape kind. Nothing else is a candidate.
 * - Unmatched objects never travel. Arrivals fade in at their final geometry;
 *   departures fade out in place.
 * - Matched pairs interpolate decomposed affine state (translate, shortest-arc
 *   rotation, scale, skew) rather than raw matrix entries, so a 270-degree
 *   pair does not spin the long way and singular intermediate matrices cannot
 *   occur. Degenerate pairs fall back to element-wise interpolation.
 */

export type MorphKindClass = 'text' | 'image' | 'shape' | 'other';

export interface MorphNodeView {
  /** Flattened engine node id on its slide. */
  id: string;
  name: string;
  kindClass: MorphKindClass;
  shapeKind?: string;
  /** Frame-local transform (world transform pulled back into slide space). */
  transformLocal: Affine;
}

export interface MorphPair {
  fromId: string;
  toId: string;
  name: string;
}

export interface MorphMatch {
  pairs: MorphPair[];
  /** Departures: fade out in place on the outgoing slide. */
  unmatchedFromIds: string[];
  /** Arrivals: fade in at final geometry on the incoming slide. */
  unmatchedToIds: string[];
}

function kindClassOf(node: EngineSceneNode): { kindClass: MorphKindClass; shapeKind?: string } {
  if (node.kind === 'text') return { kindClass: 'text' };
  const fills = node.fills ?? [];
  if (node.src || fills.some((f) => f.type === 'image')) return { kindClass: 'image' };
  const shapeKind = (node.shape as { kind?: string } | undefined)?.kind;
  if (shapeKind) return { kindClass: 'shape', shapeKind };
  return { kindClass: 'other' };
}

/**
 * Collects morph candidates from a flattened engine node list, normalizing
 * world transforms into the slide frame's local space. Group containers and
 * the slide frame itself are never candidates.
 */
export function collectMorphViews(
  nodes: readonly EngineSceneNode[],
  frameId: string,
): MorphNodeView[] {
  const frame = nodes.find((node) => node.id === frameId);
  const frameWorld = frame?.transform;
  const inverse = frameWorld ? tryInvertAffine(frameWorld as EngineAffine) : null;
  const views: MorphNodeView[] = [];
  for (const node of nodes) {
    if (node.id === frameId) continue;
    if (node.kind === 'group' || node.kind === 'frame') continue;
    const { kindClass, shapeKind } = kindClassOf(node);
    const world = node.transform as EngineAffine;
    const local =
      inverse && frameWorld ? (multiplyAffine(inverse, world) as Affine) : (world as Affine);
    views.push({ id: node.id, name: node.name, kindClass, shapeKind, transformLocal: local });
  }
  return views;
}

function uniqueByMatchKey(views: readonly MorphNodeView[]): Map<string, MorphNodeView> {
  // A name is matchable only when it occurs exactly once among candidates
  // with the same match key on this side; ambiguous names match nothing.
  const counts = new Map<string, number>();
  for (const view of views) {
    const key = `${view.kindClass}:${view.shapeKind ?? ''}:${view.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unique = new Map<string, MorphNodeView>();
  for (const view of views) {
    const key = `${view.kindClass}:${view.shapeKind ?? ''}:${view.name}`;
    if (!view.name || counts.get(key) !== 1) continue;
    unique.set(key, view);
  }
  return unique;
}

export function matchMorphNodes(
  from: readonly MorphNodeView[],
  to: readonly MorphNodeView[],
): MorphMatch {
  const toByKey = uniqueByMatchKey(to);
  const fromByKey = uniqueByMatchKey(from);
  const pairs: MorphPair[] = [];
  const matchedFrom = new Set<string>();
  const matchedTo = new Set<string>();
  for (const [key, fromView] of fromByKey) {
    const toView = toByKey.get(key);
    if (!toView) continue;
    pairs.push({ fromId: fromView.id, toId: toView.id, name: fromView.name });
    matchedFrom.add(fromView.id);
    matchedTo.add(toView.id);
  }
  return {
    pairs,
    unmatchedFromIds: from.filter((view) => !matchedFrom.has(view.id)).map((view) => view.id),
    unmatchedToIds: to.filter((view) => !matchedTo.has(view.id)).map((view) => view.id),
  };
}

export interface MorphNodeOverride {
  transform?: Affine;
  opacity?: number;
}

interface Decomposed {
  tx: number;
  ty: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
}

function decomposeOrThrow(m: Affine): Decomposed | null {
  const full = decomposeAffineFull(m);
  if (!full) return null;
  return {
    tx: full.translateX,
    ty: full.translateY,
    rotation: full.rotation,
    scaleX: full.scaleX,
    scaleY: full.scaleY,
    skewX: full.skewX,
  };
}

function recompose(d: Decomposed): Affine {
  const cos = Math.cos(d.rotation);
  const sin = Math.sin(d.rotation);
  const a = d.scaleX * cos;
  const b = d.scaleX * sin;
  const c = d.scaleY * (d.skewX * cos - sin);
  const dd = d.scaleY * (d.skewX * sin + cos);
  return [a, b, c, dd, d.tx, d.ty];
}

const SCALE_EPSILON = 1e-6;

function interpolateLocal(from: Affine, to: Affine, t: number): Affine | null {
  const a = decomposeOrThrow(from);
  const b = decomposeOrThrow(to);
  if (!a || !b) {
    // Element-wise fallback for degenerate endpoints; still deterministic.
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
      from[3] + (to[3] - from[3]) * t,
      from[4] + (to[4] - from[4]) * t,
      from[5] + (to[5] - from[5]) * t,
    ];
  }
  // Shortest-arc rotation: never spin the long way around.
  const twoPi = Math.PI * 2;
  let targetRotation = b.rotation;
  while (targetRotation - a.rotation > Math.PI) targetRotation -= twoPi;
  while (targetRotation - a.rotation < -Math.PI) targetRotation += twoPi;
  const magnitude = (value: number) => (Math.abs(value) < SCALE_EPSILON ? SCALE_EPSILON : value);
  return recompose({
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
    rotation: a.rotation + (targetRotation - a.rotation) * t,
    scaleX: magnitude(a.scaleX + (b.scaleX - a.scaleX) * t),
    scaleY: magnitude(a.scaleY + (b.scaleY - a.scaleY) * t),
    skewX: a.skewX + (b.skewX - a.skewX) * t,
  });
}

export interface MorphFrameGeometry {
  /** World transform of the outgoing slide frame. */
  frameWorldFrom: Affine;
  /** World transform of the incoming slide frame. */
  frameWorldTo: Affine;
}

/**
 * Samples one matched pair at eased progress `e` (0..1). Returns the override
 * for the incoming slide's node; the outgoing side's matched node is not
 * drawn after the halfway crossfade boundary handled by the renderer.
 */
export function sampleMorphPairOverride(
  fromNode: EngineSceneNode,
  toNode: EngineSceneNode,
  geometry: MorphFrameGeometry,
  e: number,
): MorphNodeOverride {
  const inverseFrom = tryInvertAffine(geometry.frameWorldFrom as EngineAffine);
  const localFrom = inverseFrom
    ? (multiplyAffine(inverseFrom, fromNode.transform as EngineAffine) as Affine)
    : (fromNode.transform as Affine);
  const inverseTo = tryInvertAffine(geometry.frameWorldTo as EngineAffine);
  const localTo = inverseTo
    ? (multiplyAffine(inverseTo, toNode.transform as EngineAffine) as Affine)
    : (toNode.transform as Affine);
  const local = interpolateLocal(localFrom, localTo, e);
  if (!local) return {};
  return { transform: multiplyAffine(geometry.frameWorldTo as EngineAffine, local) as Affine };
}

/**
 * Arrival/departure opacity at eased progress `e`, per the fade-in-place
 * contract for unmatched objects.
 */
export function unmatchedMorphOpacity(side: 'from' | 'to', e: number): number {
  return side === 'from' ? 1 - e : e;
}
