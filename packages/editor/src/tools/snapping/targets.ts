import {
  DEFAULT_SNAP_TOLERANCE_PX,
  type NormalizedSnapTarget,
  SNAP_RANGE_PX,
  SNAP_TOLERANCE_MAX_PX,
  SNAP_TOLERANCE_MIN_PX,
  type SnapTarget,
  type SnapTargetInput,
} from './types';

export function snapTargetSearchRect(
  bounds: { x: number; y: number; w: number; h: number },
  zoom: number,
): { x: number; y: number; w: number; h: number } {
  const padding = SNAP_RANGE_PX / Math.max(0.001, zoom);
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
  };
}

function resolvedTolerancePx(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SNAP_TOLERANCE_PX;
  }
  return Math.min(SNAP_TOLERANCE_MAX_PX, Math.max(SNAP_TOLERANCE_MIN_PX, value));
}

export function thresholdWorld(zoom: number, tolerancePx = DEFAULT_SNAP_TOLERANCE_PX): number {
  return resolvedTolerancePx(tolerancePx) / Math.max(0.001, zoom);
}

export function releaseThresholdWorld(
  zoom: number,
  tolerancePx = DEFAULT_SNAP_TOLERANCE_PX,
): number {
  return thresholdWorld(zoom, tolerancePx) * 1.5;
}

/** Screen-space bounding box of a target (cx, cy, half-extent). */
function screenBounds(
  b: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (b.x + b.w / 2) * camera.zoom,
    cy: (b.y + b.h / 2) * camera.zoom,
    rx: (b.w / 2) * camera.zoom,
    ry: (b.h / 2) * camera.zoom,
  };
}

function intersect(
  a: ReturnType<typeof screenBounds>,
  b: ReturnType<typeof screenBounds>,
): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.rx + b.rx + SNAP_RANGE_PX &&
    Math.abs(a.cy - b.cy) < a.ry + b.ry + SNAP_RANGE_PX
  );
}

export function filterSnapTargets(
  draggedBounds: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
  allBounds: Array<{
    nodeId: string;
    bounds: { x: number; y: number; w: number; h: number };
  }>,
  parentIndex: Map<string, string | null>,
  draggedId: string,
  excludedIds?: ReadonlySet<string>,
  movingRootIds?: ReadonlySet<string>,
): Array<{ x: number; y: number; w: number; h: number }> {
  return filterSnapTargetEntries(
    draggedBounds,
    camera,
    allBounds,
    parentIndex,
    draggedId,
    excludedIds,
    movingRootIds,
  ).map((target) => target.bounds);
}

/**
 * Return identity-preserving snap candidates after broad-phase and hierarchy
 * filtering. The public bounds-only wrapper above remains for older tools and
 * tests; movement uses this richer form so a sticky lock can be invalidated
 * when its target changes.
 */
export function filterSnapTargetEntries(
  draggedBounds: { x: number; y: number; w: number; h: number },
  camera: { zoom: number },
  allBounds: Array<{
    nodeId: string;
    bounds: { x: number; y: number; w: number; h: number };
  }>,
  parentIndex: Map<string, string | null>,
  draggedId: string,
  excludedIds?: ReadonlySet<string>,
  movingRootIds?: ReadonlySet<string>,
): SnapTarget[] {
  const draggedParent = parentIndex.get(draggedId) ?? null;
  const draggedScreen = screenBounds(draggedBounds, camera);
  const results: Array<SnapTarget & { priority: number }> = [];
  const movingRoots = new Set(movingRootIds ?? (draggedId ? [draggedId] : []));

  for (const entry of allBounds) {
    // Semantic filter: the dragged object, every sibling moving in the same
    // selection, and any explicitly excluded node can never be a valid target.
    if (excludedIds?.has(entry.nodeId)) continue;
    if (isInMovingHierarchy(entry.nodeId, movingRoots, parentIndex)) continue;
    const targetScreen = screenBounds(entry.bounds, camera);
    if (!intersect(draggedScreen, targetScreen)) continue;
    const targetParent = parentIndex.get(entry.nodeId) ?? null;
    const priority = draggedParent !== null && targetParent === draggedParent ? 0 : 1;
    results.push({
      id: entry.nodeId,
      bounds: entry.bounds,
      parentId: targetParent,
      priority,
    });
  }

  results.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return results.map(({ priority: _, ...target }) => target);
}

function isInMovingHierarchy(
  nodeId: string,
  movingRoots: ReadonlySet<string>,
  parentIndex: Map<string, string | null>,
): boolean {
  if (movingRoots.has(nodeId)) return true;

  // Exclude descendants: their bounds move with the selected root and are
  // self-referential snap targets. Also exclude ancestors because a frame's
  // aggregate bounds may depend on the moving child. Explicit frame/page
  // references are added separately by the canvas integration.
  let cursor: string | null = nodeId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (movingRoots.has(cursor)) return true;
    cursor = parentIndex.get(cursor) ?? null;
  }

  for (const root of movingRoots) {
    let child: string | null = root;
    const visitedRoot = new Set<string>();
    while (child && !visitedRoot.has(child)) {
      visitedRoot.add(child);
      const parent: string | null = parentIndex.get(child) ?? null;
      if (parent === nodeId) return true;
      child = parent;
    }
  }
  return false;
}

function isSnapTarget(value: SnapTargetInput): value is SnapTarget {
  return 'id' in value && 'bounds' in value && typeof value.id === 'string';
}

export function normalizeSnapTargets(targets: SnapTargetInput[]): NormalizedSnapTarget[] {
  const normalized = targets.map((target, originalIndex) => {
    if (isSnapTarget(target)) {
      return { ...target, originalIndex, explicitId: true };
    }
    return {
      id: `legacy:${originalIndex}`,
      bounds: target,
      originalIndex,
      explicitId: false,
    };
  });

  // Preserve legacy array order for callers that do not provide identity, but
  // make identity-bearing candidates independent of spatial-index iteration
  // order. This gives the same document/settings/intent a deterministic winner
  // when coincident targets are returned in a different order.
  const hasExplicitIdentity = normalized.some((target) => target.explicitId);
  if (hasExplicitIdentity) {
    normalized.sort(
      (a, b) =>
        Number(!a.explicitId) - Number(!b.explicitId) ||
        a.id.localeCompare(b.id) ||
        a.originalIndex - b.originalIndex,
    );
  }
  return normalized;
}
