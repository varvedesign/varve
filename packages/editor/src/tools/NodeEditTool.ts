/**
 * NodeEditTool — path anchor editing mode.
 *
 * Activated by double-clicking a path/bezier ShapeNode in SelectTool.
 * Manages per-anchor selection, multi-anchor drag-move, handle manipulation,
 * insertion, deletion (geometry-preserving), and corner/smooth conversion.
 * Exits back to 'select' on Escape or V.
 */
import type { PathPoint } from '@varve/engine';
import { applyAffine, invertAffine } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import { nodeWorldTransform } from '../scene/world';
import {
  deleteAnchorPreservingGeometry,
  insertPointOnSegment,
  nearestPointOnPath,
  inferPointType,
  type PointType,
} from '@varve/shared/bezierPathOps';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

const ANCHOR_HIT_RADIUS = 8;
const HANDLE_HIT_RADIUS = 6;
const SEGMENT_INSERT_HIT_TOLERANCE = 12; // CSS pixels

export class NodeEditTool extends BaseTool {
  id = 'nodeEdit' as const;

  private selectedAnchors: Set<number> = new Set();
  private draggingAnchorIdx: number | null = null;
  private dragStartAnchorPositions: Map<number, { x: number; y: number }> | null = null;
  private dragStartWorld: { x: number; y: number } | null = null;
  private draggingHandle: { anchorIdx: number; which: 'in' | 'out' } | null = null;
  private dragStartHandleValue: [number, number] | null = null;
  private dragStartAllHandleValues: Map<number, { handleIn: [number, number] | null; handleOut: [number, number] | null }> | null = null;
  private inTransaction = false;
  private altDragStarted = false;
  private insertMode: { segmentIndex: number; t: number } | null = null;

  override cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'move' };
    if (this.insertMode) return { css: 'crosshair' };
    return { css: 'default' };
  }

  override onDeactivate(ctx: ToolContext): void {
    this.endEditTransaction(ctx);
    ctx.setNodeEditTargetId(null);
    this.selectedAnchors.clear();
    this.draggingAnchorIdx = null;
    this.draggingHandle = null;
    this.dragStartHandleValue = null;
    this.dragStartAnchorPositions = null;
    this.dragStartAllHandleValues = null;
    this.altDragStarted = false;
    this.insertMode = null;
  }

  private beginEditTransaction(ctx: ToolContext): void {
    if (!this.inTransaction) {
      ctx.beginTransaction();
      this.inTransaction = true;
    }
  }

  private endEditTransaction(ctx: ToolContext): void {
    if (this.inTransaction) {
      ctx.commitTransaction();
      this.inTransaction = false;
    }
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    ctx.setPointerCapture(e.pointerId);
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return { consumed: false };

    const node = ctx.getNode(targetId);
    if (node?.kind !== 'shape' || node.shape.kind !== 'path') {
      return { consumed: false };
    }

    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const local = applyAffine(invWorld, [world.x, world.y]);

    const worldScaleX = Math.hypot(worldMat[0], worldMat[1]) || 1;
    const anchorRadiusLocal = ANCHOR_HIT_RADIUS / ctx.zoom / worldScaleX;
    const handleRadiusLocal = HANDLE_HIT_RADIUS / ctx.zoom / worldScaleX;

    const handleHit = findNearestHandle(node.shape.points, local, handleRadiusLocal);
    const anchorHit = findNearestAnchorLocal(node.shape.points, local, anchorRadiusLocal);

    if (handleHit !== null && anchorHit !== null && anchorHit === handleHit.anchorIdx) {
      // Both within radius of same anchor — anchor hit takes priority
    } else if (handleHit !== null) {
      // Handle hit
      this.beginEditTransaction(ctx);
      if (!e.shiftKey) this.selectedAnchors.clear();
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
      const pt = node.shape.points[handleHit.anchorIdx]!;
      const wasAlt = e.altKey;
      this.draggingHandle = handleHit;
      this.dragStartHandleValue = [
        ...(handleHit.which === 'in' ? pt.handleIn! : pt.handleOut!),
      ] as [number, number];
      this.dragStartWorld = world;
      this.altDragStarted = wasAlt;
      this.drag = {
        kind: 'dragging',
        pointerId: e.pointerId,
        startCanvas: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentCanvas: { x: e.clientX, y: e.clientY },
        currentWorld: world,
      };
      return { consumed: true, captured: true };
    }

    // Check for segment insertion hit (only if not clicking an anchor or handle)
    if (anchorHit === null && handleHit === null) {
      const insertHit = findSegmentInsertionPoint(
        node.shape.points,
        node.shape.closed,
        local,
        SEGMENT_INSERT_HIT_TOLERANCE / ctx.zoom / worldScaleX,
      );
      if (insertHit !== null) {
        this.beginEditTransaction(ctx);
        const newPoints = insertPointOnSegment(
          node.shape.points,
          insertHit.segmentIndex,
          insertHit.t,
        );
        ctx.updateNode(targetId, (n) => {
          if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
          return { ...n, shape: { ...n.shape, points: newPoints } } as ShapeNode;
        });
        this.endEditTransaction(ctx);
        // Select the newly inserted point
        this.selectedAnchors.clear();
        this.selectedAnchors.add(insertHit.segmentIndex + 1);
        ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));
        ctx.announce(`Anchor inserted at segment ${insertHit.segmentIndex}`);
        return { consumed: true, captured: true };
      }
    }

    if (anchorHit !== null) {
      this.beginEditTransaction(ctx);
      if (!e.shiftKey) this.selectedAnchors.clear();
      this.selectedAnchors.add(anchorHit);
      ctx.setNodeEditSelectedAnchors(new Set(this.selectedAnchors));

      // Snapshot all selected anchors' positions for multi-drag
      this.dragStartAnchorPositions = new Map();
      this.dragStartAllHandleValues = new Map();
      for (const idx of this.selectedAnchors) {
        const pt = node.shape.points[idx];
        if (!pt) continue;
        this.dragStartAnchorPositions.set(idx, { x: pt.x, y: pt.y });
        this.dragStartAllHandleValues.set(idx, {
          handleIn: pt.handleIn ? [...pt.handleIn] as [number, number] : null,
          handleOut: pt.handleOut ? [...pt.handleOut] as [number, number] : null,
        });
      }

      this.draggingAnchorIdx = anchorHit;
      this.dragStartWorld = world;
      this.drag = {
        kind: 'dragging',
        pointerId: e.pointerId,
        startCanvas: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentCanvas: { x: e.clientX, y: e.clientY },
        currentWorld: world,
      };
    } else {
      if (!e.shiftKey) {
        this.selectedAnchors.clear();
        ctx.setNodeEditSelectedAnchors(new Set());
      }
      this.draggingAnchorIdx = null;
      this.endEditTransaction(ctx);
    }

    return { consumed: true, captured: true };
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;

    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return;

    const worldMat = nodeWorldTransform(ctx.document, targetId);
    const invWorld = invertAffine(worldMat);
    const current = ctx.canvasToWorld(e.clientX, e.clientY);
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = current;

    const dw = this.dragStartWorld;
    if (!dw) return;
    const localStart = applyAffine(invWorld, [dw.x, dw.y]);
    const localCurrent = applyAffine(invWorld, [current.x, current.y]);
    const dx = localCurrent[0] - localStart[0];
    const dy = localCurrent[1] - localStart[1];

    if (this.draggingHandle !== null && this.dragStartHandleValue) {
      const { anchorIdx, which } = this.draggingHandle;
      const newHandle0 = this.dragStartHandleValue[0] + dx;
      const newHandle1 = this.dragStartHandleValue[1] + dy;
      ctx.updateNode(targetId, (n) => {
        if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
        const points: PathPoint[] = n.shape.points.map((p, i) => {
          if (i !== anchorIdx) return p;
          if (which === 'in') {
            const updated = { ...p, handleIn: [newHandle0, newHandle1] as [number, number] };
            if (!this.altDragStarted) {
              updated.handleOut = [-newHandle0, -newHandle1] as [number, number];
            }
            return updated;
          }
          const updated = { ...p, handleOut: [newHandle0, newHandle1] as [number, number] };
          if (!this.altDragStarted) {
            if (p.handleIn) {
              updated.handleIn = [-newHandle0, -newHandle1] as [number, number];
            }
          }
          return updated;
        });
        return { ...n, shape: { ...n.shape, points } } as ShapeNode;
      });
      return;
    }

    if (!this.dragStartAnchorPositions || !this.dragStartWorld) return;

    // Multi-node drag: snapshot-based, no incremental drift
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points = n.shape.points.map((p, i) => {
        const startPos = this.dragStartAnchorPositions!.get(i);
        if (!startPos) return p;
        return { ...p, x: startPos.x + dx, y: startPos.y + dy };
      });
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    ctx.releasePointerCapture(e.pointerId);
    this.endEditTransaction(ctx);
    this.draggingAnchorIdx = null;
    this.dragStartAnchorPositions = null;
    this.dragStartAllHandleValues = null;
    this.dragStartHandleValue = null;
    this.dragStartWorld = null;
    this.draggingHandle = null;
    this.altDragStarted = false;
    this.drag = {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' || e.key === 'v') {
      ctx.setTool('select');
      return true;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      return this.deleteSelectedAnchors(ctx);
    }

    if (e.key === 'c' || e.key === 'C') {
      return this.toggleCornerSmooth(ctx);
    }

    // Keyboard nudge
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
    if (isArrow) {
      e.preventDefault();
      return this.nudgeSelectedAnchors(e.key, e.shiftKey, ctx);
    }

    return false;
  }

  private nudgeSelectedAnchors(
    key: string,
    shift: boolean,
    ctx: ToolContext,
  ): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;

    const step = shift ? 10 : 1;
    let ddx = 0;
    let ddy = 0;
    switch (key) {
      case 'ArrowUp': ddy = -step; break;
      case 'ArrowDown': ddy = step; break;
      case 'ArrowLeft': ddx = -step; break;
      case 'ArrowRight': ddx = step; break;
      default: return false;
    }

    this.beginEditTransaction(ctx);
    const toNudge = new Set(this.selectedAnchors);
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const points = n.shape.points.map((p, i) => {
        if (!toNudge.has(i)) return p;
        return { ...p, x: p.x + ddx, y: p.y + ddy };
      });
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
    this.endEditTransaction(ctx);
    ctx.announce(`Nudged ${this.selectedAnchors.size} anchor${this.selectedAnchors.size > 1 ? 's' : ''}`);
    return true;
  }

  private deleteSelectedAnchors(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;
    const node = ctx.getNode(targetId);
    if (node?.kind !== 'shape' || node.shape.kind !== 'path') return false;

    const toRemove = new Set(this.selectedAnchors);
    const n = node.shape.points.length;
    const remaining = n - toRemove.size;
    if (remaining < 2) return false;

    // Use geometry-preserving deletion
    ctx.beginTransaction();
    ctx.updateNode(targetId, (nd) => {
      if (nd.kind !== 'shape' || nd.shape.kind !== 'path') return nd;
      const deleted = deleteAnchorPreservingGeometry(
        nd.shape.points,
        // For multi-delete, process in descending order
        ...[...toRemove].sort((a, b) => b - a).map((idx) => idx),
        nd.shape.closed,
      );
      if (!deleted) return nd;
      return { ...nd, shape: { ...nd.shape, points: deleted } } as ShapeNode;
    });
    ctx.commitTransaction();

    const count = this.selectedAnchors.size;
    this.selectedAnchors.clear();
    ctx.setNodeEditSelectedAnchors(new Set());
    ctx.announce(`Deleted ${count} anchor${count > 1 ? 's' : ''}`);
    return true;
  }

  private toggleCornerSmooth(ctx: ToolContext): boolean {
    if (this.selectedAnchors.size === 0) return false;
    const targetId = ctx.nodeEditTargetId;
    if (!targetId) return false;

    const toToggle = new Set(this.selectedAnchors);
    ctx.updateNode(targetId, (n) => {
      if (n.kind !== 'shape' || n.shape.kind !== 'path') return n;
      const s = n.shape;
      const points: PathPoint[] = s.points.map((p, i) => {
        if (!toToggle.has(i)) return p;
        if (p.handleIn === null && p.handleOut === null) {
          const len = computeDefaultHandleLength(s.points, i);
          const prevDir = computeHandleDirection(s.points, i, 'prev');
          const nextDir = computeHandleDirection(s.points, i, 'next');
          return {
            ...p,
            handleIn: [prevDir[0] * len, prevDir[1] * len] as [number, number],
            handleOut: [nextDir[0] * len, nextDir[1] * len] as [number, number],
          };
        }
        return { ...p, handleIn: null, handleOut: null };
      });
      return { ...n, shape: { ...n.shape, points } } as ShapeNode;
    });
    return true;
  }

  getSelectedAnchors(): ReadonlySet<number> {
    return this.selectedAnchors;
  }

  getPointType(points: readonly PathPoint[], idx: number): PointType {
    const prev = idx > 0 ? points[idx - 1] : null;
    const next = idx < points.length - 1 ? points[idx + 1] : null;
    return inferPointType(points[idx]!, prev, next);
  }
}

function findNearestAnchorLocal(
  points: PathPoint[],
  local: readonly [number, number],
  radius: number,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dx = local[0] - p.x;
    const dy = local[1] - p.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < bestDist) {
      bestDist = dist2;
      best = i;
    }
  }
  return best;
}

function findNearestHandle(
  points: PathPoint[],
  local: readonly [number, number],
  radius: number,
): { anchorIdx: number; which: 'in' | 'out' } | null {
  const r2 = radius * radius;
  let best: { anchorIdx: number; which: 'in' | 'out' } | null = null;
  let bestDist = r2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.handleIn) {
      const hx = p.x + p.handleIn[0];
      const hy = p.y + p.handleIn[1];
      const dx = local[0] - hx;
      const dy = local[1] - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = { anchorIdx: i, which: 'in' };
      }
    }
    if (p.handleOut) {
      const hx = p.x + p.handleOut[0];
      const hy = p.y + p.handleOut[1];
      const dx = local[0] - hx;
      const dy = local[1] - hy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = { anchorIdx: i, which: 'out' };
      }
    }
  }
  return best;
}

function findSegmentInsertionPoint(
  points: readonly PathPoint[],
  closed: boolean,
  local: readonly [number, number],
  tolerance: number,
): { segmentIndex: number; t: number } | null {
  if (points.length < 2) return null;

  const segs: Array<[number, number]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push([i, i + 1]);
  }
  if (closed && points.length > 2) {
    segs.push([points.length - 1, 0]);
  }

  let bestResult: { segmentIndex: number; t: number } | null = null;
  let bestDist = tolerance;

  for (const [i, j] of segs) {
    const result = nearestPointOnPath(
      [points[i]!, points[j]!],
      false,
      { x: local[0], y: local[1] },
    );
    if (result && result.dist < bestDist) {
      bestDist = result.dist;
      bestResult = { segmentIndex: i, t: result.t };
    }
  }

  return bestResult;
}

function computeDefaultHandleLength(points: PathPoint[], idx: number): number {
  const prev = idx > 0 ? points[idx - 1] : null;
  const next = idx < points.length - 1 ? points[idx + 1] : null;
  const p = points[idx]!;

  let len = 20;
  if (prev) {
    len = Math.sqrt((p.x - prev.x) ** 2 + (p.y - prev.y) ** 2) / 3;
  }
  if (next) {
    const nextLen = Math.sqrt((next.x - p.x) ** 2 + (next.y - p.y) ** 2) / 3;
    len = Math.min(len, nextLen);
  }
  return Math.max(len, 4);
}

function computeHandleDirection(
  points: PathPoint[],
  idx: number,
  dir: 'prev' | 'next',
): [number, number] {
  const p = points[idx]!;
  if (dir === 'prev' && idx > 0) {
    const prev = points[idx - 1]!;
    const dx = prev.x - p.x;
    const dy = prev.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  if (dir === 'next' && idx < points.length - 1) {
    const next = points[idx + 1]!;
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  if (dir === 'next') return [1, 0];
  return [-1, 0];
}
