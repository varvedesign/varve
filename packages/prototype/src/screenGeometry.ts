/**
 * Prototype screen geometry — the single derivation that maps scene
 * coordinates onto a prototype frame box, shared by the rendered screen
 * raster and by every active region on that screen.
 *
 * Why this module exists: the previous implementation placed hotspots from
 * `node.transform[4..5] + nodeLocalBounds(node)` — the node's own parent-space
 * translation plus its own local rect — while the screen image was produced by
 * `generateThumbnail`, which normalises its own `sourceBounds` to the raster
 * origin and is then stretched into the frame box by CSS. Two independent
 * derivations of one geometry is the defect class this module removes: the
 * visible pixel and the active region now come from the same evaluated state.
 *
 * Coordinate chain, in order:
 *   node local space
 *     → scene space            (`nodeWorldTransform`, ancestors composed)
 *     → raster pixel space     (`sourceBounds` origin + `scaleFactor`)
 *     → frame-box CSS space    (uniform contain-fit + centring letterbox)
 *
 * The raster step is described by the engine's own reported metadata
 * (`sourceBounds`, `scaleFactor`, `outputWidth`, `outputHeight`), so the
 * mapping cannot silently drift from what was rendered. When no raster exists
 * (a non-canvas environment, or before the image resolves) the mapping
 * degenerates to the screen frame's own bounds at 1 CSS px per scene unit,
 * which keeps hotspots correct without an image to agree with.
 *
 * Research basis: Figma prototype scroll/overflow and overlay documentation
 * (fixed/sticky elements, connector-level vs overlay-level settings),
 * Penpot prototyping (overlay "relative to" reference space), and the
 * documented requirement that a prototype's interactive regions track the
 * artwork they belong to.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { getParent, nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { applyAffine, tryInvertAffine } from '@varve/shared';

/** A rectangle in some space, using that space's units. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What the engine actually rendered for a screen: the scene rectangle that
 * became the raster's top-left, the raster's pixel size, and the scale it
 * applied. Mirrors the engine's `ThumbnailMetadata` for the fields that
 * participate in the mapping.
 */
export interface ScreenRasterInfo {
  sourceBounds: ScreenRect;
  outputWidth: number;
  outputHeight: number;
  scaleFactor: number;
}

/** Scene space → frame-box CSS space, as a uniform scale plus a translation. */
export interface ScreenFrameMapping {
  /** CSS px per scene unit. */
  scale: number;
  /** Translation applied after scaling, in CSS px. */
  offsetX: number;
  offsetY: number;
  /**
   * True when the raster does not exactly fill the frame box, so the artwork
   * is letterboxed rather than stretched. Callers can surface this instead of
   * silently distorting an aspect ratio the author never chose.
   */
  letterboxed: boolean;
  frameWidth: number;
  frameHeight: number;
}

/** A layer that can own active regions on a prototype screen. */
export type PrototypeHotspotLayer = 'screen' | 'overlay';

/**
 * One active region on a prototype screen, resolved from the same geometry
 * the raster was rendered from.
 *
 * `rect` is the axis-aligned frame-box box used to place the DOM control.
 * `localRect` + `inverseWorldTransform` are the exact test used for hit
 * resolution, so a rotated or skewed node is resolved in its own space instead
 * of against a loose world AABB.
 */
export interface PrototypeHotspot {
  nodeId: NodeId;
  nodeName: string;
  layer: PrototypeHotspotLayer;
  /** Overlay root id when `layer` is `'overlay'`. */
  overlayId?: NodeId;
  /** Higher paints later, therefore sits on top and wins a hit. */
  paintOrder: number;
  /** Frame-box CSS box, clipped to the frame box. */
  rect: ScreenRect;
  /** Scene-space AABB before mapping, for diagnostics and pairwise checks. */
  sceneRect: ScreenRect;
  /** Invertible local→scene transform, or null when the node has no own space. */
  inverseWorldTransform: Affine | null;
  /** Node-local bounds paired with `inverseWorldTransform`, or null. */
  localRect: ScreenRect | null;
  /** Ids of the enabled interactions that make this node active. */
  interactionIds: string[];
}

/** A point in frame-box CSS space. */
export interface FramePoint {
  x: number;
  y: number;
}

/**
 * The mapping used when no raster is available. The screen frame's own scene
 * bounds map onto the frame box at one CSS px per scene unit, which is exactly
 * what the box would show if the screen were drawn unscaled.
 */
export function identityScreenRaster(screenBounds: ScreenRect): ScreenRasterInfo {
  return {
    sourceBounds: screenBounds,
    outputWidth: Math.max(1, screenBounds.w),
    outputHeight: Math.max(1, screenBounds.h),
    scaleFactor: 1,
  };
}

/**
 * Derive the scene → frame-box mapping from the raster the engine produced.
 *
 * The raster is displayed with a uniform contain fit centred in the frame box,
 * so the artwork is never distorted: an aspect ratio the author did not choose
 * cannot be introduced by the viewer.
 */
export function screenFrameMapping(
  frameWidth: number,
  frameHeight: number,
  raster: ScreenRasterInfo,
): ScreenFrameMapping {
  const boxW = Math.max(1, frameWidth);
  const boxH = Math.max(1, frameHeight);
  const outW = Math.max(1, raster.outputWidth);
  const outH = Math.max(1, raster.outputHeight);
  const boxScale = Math.min(boxW / outW, boxH / outH);
  const drawnW = outW * boxScale;
  const drawnH = outH * boxScale;
  return {
    scale: boxScale * raster.scaleFactor,
    offsetX: (boxW - drawnW) / 2,
    offsetY: (boxH - drawnH) / 2,
    letterboxed: Math.abs(drawnW - boxW) > 0.5 || Math.abs(drawnH - boxH) > 0.5,
    frameWidth: boxW,
    frameHeight: boxH,
  };
}

/** Map a scene point into frame-box CSS space. */
export function scenePointToFrame(
  mapping: ScreenFrameMapping,
  raster: ScreenRasterInfo,
  point: FramePoint,
): FramePoint {
  return {
    x: mapping.offsetX + (point.x - raster.sourceBounds.x) * mapping.scale,
    y: mapping.offsetY + (point.y - raster.sourceBounds.y) * mapping.scale,
  };
}

/** Map a scene rectangle into frame-box CSS space (axis-aligned, unscaled size). */
export function sceneRectToFrame(
  mapping: ScreenFrameMapping,
  raster: ScreenRasterInfo,
  rect: ScreenRect,
): ScreenRect {
  const origin = scenePointToFrame(mapping, raster, { x: rect.x, y: rect.y });
  return {
    x: origin.x,
    y: origin.y,
    w: rect.w * mapping.scale,
    h: rect.h * mapping.scale,
  };
}

/** Invert the mapping: frame-box CSS point → scene point. */
export function framePointToScene(
  mapping: ScreenFrameMapping,
  raster: ScreenRasterInfo,
  point: FramePoint,
): FramePoint | null {
  if (!Number.isFinite(mapping.scale) || mapping.scale === 0) return null;
  return {
    x: (point.x - mapping.offsetX) / mapping.scale + raster.sourceBounds.x,
    y: (point.y - mapping.offsetY) / mapping.scale + raster.sourceBounds.y,
  };
}

/**
 * Sentinel for "no clip applies". Deliberately finite: `-Infinity + Infinity`
 * is `NaN`, so an infinite rectangle silently poisons every intersection it
 * takes part in. Scene coordinates are far smaller than this bound.
 */
const UNBOUNDED: ScreenRect = { x: -1e12, y: -1e12, w: 2e12, h: 2e12 };

function intersectRect(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function containsPoint(rect: ScreenRect, point: FramePoint): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  );
}

/**
 * Build a child → parent index in one pass.
 *
 * Both `nodeWorldBounds` and `nodeWorldTransform` accept this index; without it
 * each lookup rescans every node in the document, which turns resolving one
 * screen's hotspot set into quadratic work on a large document.
 */
export function buildParentIndex(doc: Document): Map<NodeId, NodeId> {
  const index = new Map<NodeId, NodeId>();
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'frame' && node.kind !== 'group') continue;
    const children: readonly NodeId[] | undefined = (node as { children?: NodeId[] }).children;
    if (!children) continue;
    for (const childId of children) index.set(childId, node.id);
  }
  return index;
}

/**
 * Node ids on `screenId` (or in the overlay stack) that carry at least one
 * enabled interaction. A node without an interaction is not a hotspot: the
 * previous implementation emitted a focusable button for every immediate
 * child, which announced decoration to assistive technology as an action.
 */
export function interactiveNodeIds(
  doc: Document,
  screenIds: readonly NodeId[],
): Map<NodeId, string[]> {
  const result = new Map<NodeId, string[]>();
  const interactions = doc.interactions ?? {};
  for (const nodeId of screenIds) {
    const interactionIds: string[] = [];
    for (const interaction of interactions[nodeId] ?? []) {
      if (interaction.enabled !== false && interaction.id) interactionIds.push(interaction.id);
    }
    if (interactionIds.length > 0) result.set(nodeId, interactionIds);
  }
  return result;
}

/** Default traversal bound. Prototype screens are authorable, not machine-generated. */
const DEFAULT_MAX_NODES = 5_000;

export interface ResolveHotspotsArgs {
  document: Document;
  screenId: NodeId;
  /** Overlay roots, bottom-first (`overlayStack[0]` is the oldest). */
  overlayStack?: readonly NodeId[];
  frameWidth: number;
  frameHeight: number;
  /** Raster the image was rendered from; omit when unavailable. */
  raster?: ScreenRasterInfo | null;
  /** Defaults to the interactions map on the document. */
  interactiveIds?: ReadonlyMap<NodeId, string[]>;
  maxNodes?: number;
}

export interface ResolvedHotspots {
  hotspots: PrototypeHotspot[];
  mapping: ScreenFrameMapping;
  raster: ScreenRasterInfo;
  /** Nodes visited before the traversal bound was reached, when it was reached. */
  truncated: boolean;
}

/**
 * Resolve every active region for a screen and its overlay stack, in the order
 * a hit should be resolved: topmost overlay first, then the screen layer, and
 * within a layer by descending paint order (later siblings paint on top).
 *
 * Clip accumulation honours `clipContent` (default `true` on frames), which is
 * the same policy the CSS and SVG emitters already use, so a region cannot
 * escape the frame that visually clips it.
 */
export function resolvePrototypeHotspots(args: ResolveHotspotsArgs): ResolvedHotspots {
  const { document: doc, screenId, frameWidth, frameHeight } = args;
  const overlayStack = args.overlayStack ?? [];
  const maxNodes = args.maxNodes ?? DEFAULT_MAX_NODES;
  const parentIndex = buildParentIndex(doc);

  const screenBounds = nodeWorldBounds(doc, screenId, parentIndex) ?? {
    x: 0,
    y: 0,
    w: frameWidth,
    h: frameHeight,
  };
  const raster = args.raster ?? identityScreenRaster(screenBounds);
  const mapping = screenFrameMapping(frameWidth, frameHeight, raster);

  const interactiveIds =
    args.interactiveIds ??
    interactiveNodeIds(doc, [screenId, ...overlayStack, ...Object.keys(doc.interactions ?? {})]);

  const hotspots: PrototypeHotspot[] = [];
  let visited = 0;
  let truncated = false;
  let paintCounter = 0;

  const layerRoots: Array<{ root: NodeId; layer: PrototypeHotspotLayer; overlayId?: NodeId }> = [
    { root: screenId, layer: 'screen' },
    ...overlayStack.map((overlayId) => ({
      root: overlayId,
      layer: 'overlay' as const,
      overlayId,
    })),
  ];

  for (const { root, layer, overlayId } of layerRoots) {
    const stack: Array<{ id: NodeId; clip: ScreenRect | null }> = [];
    stack.push({ id: root, clip: UNBOUNDED });

    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      if (visited >= maxNodes) {
        truncated = true;
        break;
      }
      visited += 1;
      const node: SceneNode | undefined = doc.nodes[next.id];
      if (!node || node.visible === false) continue;
      // `null` means an ancestor frame clipped this entire subtree away.
      if (next.clip === null) continue;

      const paintOrder = paintCounter;
      paintCounter += 1;

      const sceneRect = nodeWorldBounds(doc, next.id, parentIndex);
      const worldTransform = nodeWorldTransform(doc, next.id, parentIndex);
      const localRect = nodeLocalBounds(node, doc);

      const interactionIds = interactiveIds.get(next.id);
      const hidden = node.opacity === 0;

      // A region fully clipped by an ancestor frame is not reachable: it must
      // produce no hotspot rather than falling back to its unclipped box.
      const clipped = sceneRect ? intersectRect(sceneRect, next.clip) : null;

      if (sceneRect && clipped && interactionIds && interactionIds.length > 0 && !hidden) {
        const frameRect = sceneRectToFrame(mapping, raster, clipped);
        const bounded = intersectRect(frameRect, {
          x: 0,
          y: 0,
          w: mapping.frameWidth,
          h: mapping.frameHeight,
        });
        if (bounded) {
          hotspots.push({
            nodeId: next.id,
            nodeName: node.name,
            layer,
            overlayId,
            paintOrder,
            rect: bounded,
            sceneRect,
            inverseWorldTransform: tryInvertAffine(worldTransform),
            localRect,
            interactionIds,
          });
        }
      }

      if (node.kind === 'frame' || node.kind === 'group') {
        const children: readonly NodeId[] | undefined = (node as { children?: NodeId[] }).children;
        if (!children || children.length === 0) continue;
        const clips =
          node.kind === 'frame' ? (node as { clipContent?: boolean }).clipContent !== false : false;
        // `clipped` already accounts for this node's own rectangle, so it is
        // exactly what its children are confined to when the node clips.
        const childClip = clips ? clipped : next.clip;
        // Push in reverse so the first child is visited first, keeping
        // paint order aligned with document order.
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const childId = children[i];
          if (childId) stack.push({ id: childId, clip: childClip });
        }
      }
    }
  }

  // Overlays are a stack; the top of the array paints last and wins first.
  const layerRank = (hotspot: PrototypeHotspot): number => {
    if (hotspot.layer !== 'overlay' || !hotspot.overlayId) return -1;
    return overlayStack.indexOf(hotspot.overlayId);
  };

  hotspots.sort((a, b) => {
    const rankA = layerRank(a);
    const rankB = layerRank(b);
    if (rankA !== rankB) return rankB - rankA;
    return b.paintOrder - a.paintOrder;
  });

  return { hotspots, mapping, raster, truncated };
}

/**
 * Resolve which active region a frame-box point activates, or null when the
 * point misses every region.
 *
 * A node with its own invertible space is tested in that space against its
 * local bounds, so rotation and skew are exact. A node without one (a group,
 * which has no geometry of its own) falls back to its world AABB.
 */
export function hitTestPrototypeHotspots(
  hotspots: readonly PrototypeHotspot[],
  point: FramePoint,
  mapping: ScreenFrameMapping,
  raster: ScreenRasterInfo,
): PrototypeHotspot | null {
  const scenePoint = framePointToScene(mapping, raster, point);
  if (!scenePoint) return null;

  for (const hotspot of hotspots) {
    if (hotspot.inverseWorldTransform && hotspot.localRect) {
      const local = applyAffine(hotspot.inverseWorldTransform, [scenePoint.x, scenePoint.y]);
      if (containsPoint(hotspot.localRect, { x: local[0], y: local[1] })) return hotspot;
      continue;
    }
    if (containsPoint(hotspot.sceneRect, scenePoint)) return hotspot;
  }
  return null;
}

/**
 * The scene rectangle a hotspot belongs to, expressed in scene units.
 * Exposed so callers that need to compare a hotspot with authored geometry
 * (measurement, preflight) do not have to invert the frame mapping.
 */
export function hotspotSceneRect(hotspot: PrototypeHotspot): ScreenRect {
  return hotspot.sceneRect;
}

/** Walk the ancestor chain of a node, nearest first. Bounded against cycles. */
export function ancestorChain(doc: Document, nodeId: NodeId, limit = 256): NodeId[] {
  const chain: NodeId[] = [];
  let current = getParent(doc, nodeId);
  while (current && chain.length < limit) {
    chain.push(current);
    current = getParent(doc, current);
  }
  return chain;
}
