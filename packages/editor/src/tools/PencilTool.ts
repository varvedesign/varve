/**
 * PencilTool — freehand path drawing.
 *
 * Captures pointer points at animation-frame rate, then on release applies
 * Ramer-Douglas-Peucker simplification, Schneider Bezier curve fitting,
 * and commits a path shape with proper handles.
 *
 * Research basis: Figma Pencil (shift+P), Illustrator Pencil (N).
 *                 Schneider, P. Graphics Gems (1990).
 */

import type { PathPoint } from '@varve/engine';
import { OneEuroFilter, oneEuroFilterPoint, strokePoint } from '@varve/scene';
import {
  cancelEditorFrame,
  createEditorFrameKey,
  requestEditorFrame,
} from '../performance/editorFrameRuntime';
import { BaseTool } from './BaseTool';
import { pressureForDrawingInput } from './drawingInputRuntime';
import type { Point2D } from './fitting';
import { fitPathToBeziers, PRESSURE_PROFILE_EPSILON, simplifyPoints } from './fitting';
import { collectSourceEvents, normalizeInputEvent } from './inputNormalizer';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

interface CapturedPoint extends Point2D {
  pressure: number;
}

export class PencilTool extends BaseTool {
  id = 'pencil' as const;

  private captured: CapturedPoint[] = [];
  private readonly frameKey = createEditorFrameKey('pencil');
  /** Per-point pressure tracking. Updated from each pointer event. */
  private currentPressure: number = 0.5;

  private oneEuro: OneEuroFilter = new OneEuroFilter(1.0, 0.007, 1.0);

  /**
   * Stabilization strength: 0 = disabled (identity pass-through), 1 = full
   * strength. Default 0.3 (light stabilization).
   *
   * The filter is bypassed entirely at 0 rather than being given a very high
   * cutoff. A one-euro filter is asymptotic: at strength 0 the old mapping
   * still produced a cutoff of 11 Hz, which at a 60 Hz event rate keeps only
   * ~54 % of each new sample — a visible lag and a shortened stroke for a user
   * who explicitly turned smoothing off. Off has to mean off.
   */
  private stabilizationStrength: number = 0.3;

  /** Self-advancing time counter for the OneEuro filter (avoids dt=0 in fake-timer tests). */
  private filterTime = 0;

  /** Last raw (unfiltered) sample, used to reject synthetic duplicates. */
  private lastRawX: number | null = null;
  private lastRawY: number | null = null;
  private lastRawPressure: number | null = null;

  setStabilization(strength: number): void {
    this.stabilizationStrength = Math.max(0, Math.min(1, strength));
    // Strength 0 means identity. Above 0 the cutoff falls as strength rises,
    // so heavier smoothing lags further behind the pointer.
    const minCutoff =
      this.stabilizationStrength === 0
        ? Number.POSITIVE_INFINITY
        : 1 + (1 - this.stabilizationStrength) * 10;
    this.oneEuro.updateConfig({ minCutoff });
  }

  /** Apply the declared stabilizer policy to one raw sample. */
  private stabilise(
    x: number,
    y: number,
    time: number,
    terminal = false,
  ): { x: number; y: number } {
    // A stabilizer is a lag filter, so its output is always behind the pointer.
    // Committing that lagged position on release would end every smoothed
    // stroke short of where the artist actually lifted the pen (measured at
    // ~12 world px for a 240 px drag at full strength). The terminal sample is
    // the one position that must be exact.
    if (terminal || this.stabilizationStrength === 0) return { x, y };
    this.filterTime = Math.max(this.filterTime, time);
    const filtered = oneEuroFilterPoint(strokePoint(x, y, { time: this.filterTime }), this.oneEuro);
    return { x: filtered.x, y: filtered.y };
  }

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const input = normalizeInputEvent(e);
    this.currentPressure = pressureForDrawingInput(
      input.pressure,
      ctx.pressureEnabled,
      ctx.pressureCurve,
    );
    this.oneEuro.reset();
    this.filterTime = input.time;
    const filtered = this.stabilise(world.x, world.y, input.time);
    this.lastRawX = world.x;
    this.lastRawY = world.y;
    this.lastRawPressure = this.currentPressure;
    this.captured = [{ x: filtered.x, y: filtered.y, pressure: this.currentPressure }];
    this.startCapture(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
    this.currentPressure = pressureForDrawingInput(
      normalizeInputEvent(e).pressure,
      ctx.pressureEnabled,
      ctx.pressureCurve,
    );

    // Sample coalesced sub-frame events when available (Chrome/Firefox/Safari 18.2+).
    // WebKitGTK returns a stub — falls back to the single event.
    const events = ctx.sourceEvents.length > 0 ? ctx.sourceEvents : collectSourceEvents(e, true);
    for (const ev of events) {
      if (ev.isPredicted) continue;
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      this.samplePoint(
        world,
        pressureForDrawingInput(ev.pressure, ctx.pressureEnabled, ctx.pressureCurve),
        ev.time,
        ctx,
      );
    }
  }

  /** Append a captured point if it moved enough from the last sample. */
  private samplePoint(
    world: { x: number; y: number },
    pressure: number,
    time: number,
    ctx: ToolContext,
    force = false,
    terminal = false,
  ): void {
    if (this.captured.length === 0) return;

    // The animation-frame loop re-samples the *latest* pointer position so a
    // slow frame does not lose the last position. When the pointer has not
    // actually moved and its pressure has not changed, that re-sample is a
    // synthetic duplicate: the stabilizer would drift toward the same raw
    // point purely from elapsed time and deposit a nibble that the user never
    // drew. Rejecting it keeps committed geometry independent of frame rate.
    const unchanged =
      this.lastRawX !== null &&
      this.lastRawY !== null &&
      world.x === this.lastRawX &&
      world.y === this.lastRawY &&
      pressure === this.lastRawPressure;
    if (unchanged && !force) return;
    this.lastRawX = world.x;
    this.lastRawY = world.y;
    this.lastRawPressure = pressure;

    const filtered = this.stabilise(world.x, world.y, time, terminal);

    const last = this.captured[this.captured.length - 1] as CapturedPoint;
    const dx = filtered.x - last.x;
    const dy = filtered.y - last.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > 1 || (force && distanceSquared > 0) || pressure !== last.pressure) {
      this.captured.push({ x: filtered.x, y: filtered.y, pressure });
      ctx.setDraft({
        kind: 'freehand',
        points: this.captured,
        label: `${this.captured.length} pts`,
      });
    }
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);
    const input = normalizeInputEvent(e);
    this.currentPressure = pressureForDrawingInput(
      input.pressure,
      ctx.pressureEnabled,
      ctx.pressureCurve,
    );
    this.samplePoint(this.drag.currentWorld, this.currentPressure, input.time, ctx, true, true);
    this.stopCapture();

    const startWorld = { x: this.drag.startWorld.x, y: this.drag.startWorld.y };
    ctx.beginTransaction();
    try {
      if (this.captured.length < 2) {
        // A tap is a real mark, not an empty node. It is committed through the
        // same path branch as a stroke so it inherits the ink stroke, the
        // resolved parent and the captured pressure; a tap that produced an
        // invisible zero-point path (the previous behaviour) left a junk layer
        // and no visible dot.
        const parentId = this.commitToParent(startWorld, ctx);
        ctx.createShapeAt(startWorld, undefined, parentId, this.dotAnchors(startWorld), false);
        super.onPointerUp(e, ctx);
        this.reset();
        return;
      }

      // Simplify with zoom-aware epsilon (2 screen pixels → world units).
      // The Bezier fit uses the same on-screen budget so the committed
      // centreline error stays ~2 screen px at every zoom level instead of
      // growing with it.
      const SCREEN_PX_EPSILON = 2;
      const epsilon = SCREEN_PX_EPSILON / ctx.zoom;
      const simplified = simplifyPoints(this.captured, epsilon, PRESSURE_PROFILE_EPSILON);
      const fitted = fitPathToBeziers(simplified, {
        maxError: epsilon,
        pressureEpsilon: PRESSURE_PROFILE_EPSILON,
      });
      // Per-point pressure from captured data
      const pathPoints: PathPoint[] = fitted.map((p) => ({
        x: p.x,
        y: p.y,
        handleIn: p.handleIn as [number, number] | null,
        handleOut: p.handleOut as [number, number] | null,
        pressure: p.pressure ?? 0.5,
      }));

      const parentId = this.commitToParent(startWorld, ctx);

      ctx.createShapeAt(startWorld, undefined, parentId, pathPoints, false);
    } finally {
      ctx.commitTransaction();
    }
    super.onPointerUp(e, ctx);
    this.reset();
  }

  /**
   * Anchors for a tap: one contact, expressed as a zero-length open path so it
   * stays editable vector geometry. The ink stroke's round cap paints the dot;
   * the captured pressure scales it like the start of any other stroke.
   */
  private dotAnchors(world: { x: number; y: number }): PathPoint[] {
    const pressure = this.captured[0]?.pressure ?? this.currentPressure;
    const anchor = { x: world.x, y: world.y, handleIn: null, handleOut: null, pressure };
    return [{ ...anchor }, { ...anchor }];
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.stopCapture();
    this.reset();
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.stopCapture();
      this.reset();
      ctx.setDraft(null);
      return true;
    }
    return false;
  }

  private startCapture(ctx: ToolContext): void {
    const capture = (frameTimeMs: number) => {
      if (this.drag.kind !== 'dragging') return;
      if (this.captured.length > 0) {
        this.samplePoint(this.drag.currentWorld, this.currentPressure, frameTimeMs, ctx);
      }
      requestEditorFrame(this.frameKey, 'input', capture);
    };
    requestEditorFrame(this.frameKey, 'input', capture);
  }

  private stopCapture(): void {
    cancelEditorFrame(this.frameKey);
  }

  private reset(): void {
    this.captured = [];
    this.oneEuro.reset();
    this.filterTime = 0;
    this.lastRawX = null;
    this.lastRawY = null;
    this.lastRawPressure = null;
    this.drag = {
      kind: 'idle',
      pointerId: -1,
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
    };
  }
}
