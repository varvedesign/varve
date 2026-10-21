import {
  buildParentIndexMap,
  calloutTailBendPoint,
  calloutTails,
  calloutTailTip,
  isCalloutGroup,
  moveCalloutBodyKeepingTailTips,
  updateCalloutTailBendPoint,
  updateCalloutTailEndpoint,
} from '@varve/scene';
import type { Affine, Camera, Point, Viewport } from '@varve/shared';
import { applyAffine, screenToWorld, tryInvertAffine, worldToScreen } from '@varve/shared';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor, useViewport } from '../context';
import { isNodeEffectivelyLocked, nodeWorldTransform } from '../scene/world';
import './CalloutManipulationOverlay.css';

type HandleMode = 'body' | 'tip' | 'bend';

interface ActiveDrag {
  mode: HandleMode;
  pointerId: number;
  groupId: string;
  tailId?: string;
  groupInverse: Affine;
  canvasLeft: number;
  canvasTop: number;
  startClient: Point;
  lastLocal: Point;
  started: boolean;
}

interface HandlePoint {
  mode: HandleMode;
  tailId?: string;
  index: number;
  point: { x: number; y: number };
  screenOffset?: Point;
  label: string;
}

const DRAG_THRESHOLD_CSS_PX = 3;

/** Direct, screen-space controls for pointed tails on a selected callout. */
export function CalloutManipulationOverlay({
  canvasRef,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const editor = useEditor();
  const viewportState = useViewport();
  const [preview, setPreview] = useState<{
    groupId: string;
    from: Point;
    to: Point;
  } | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const document = editor.state.document;
  const selectedId = editor.state.selection.length === 1 ? editor.state.selection[0] : undefined;
  const candidate = selectedId ? document.nodes[selectedId] : undefined;
  const group = isCalloutGroup(candidate) ? candidate : undefined;
  const parentIndex = useMemo(() => buildParentIndexMap(document), [document]);
  const groupWorld = group ? nodeWorldTransform(document, group.id, parentIndex) : null;
  const groupInverse = groupWorld ? tryInvertAffine(groupWorld) : null;
  const tails = group?.callout.parametric ? calloutTails(group) : [];

  useEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const activeGroup = document.nodes[drag.groupId];
    const stillEditable =
      isCalloutGroup(activeGroup) &&
      activeGroup.callout.parametric &&
      editor.state.tool === 'select' &&
      editor.state.selection.length === 1 &&
      editor.state.selection[0] === drag.groupId &&
      !isNodeEffectivelyLocked(document, drag.groupId);
    if (stillEditable) return;
    if (drag.started) editor.abortTransaction();
    dragRef.current = null;
    setPreview(null);
  }, [document, editor.abortTransaction, editor.state.selection, editor.state.tool]);

  const handles = useMemo<HandlePoint[]>(() => {
    if (!group || !groupWorld || editor.state.tool !== 'select') return [];
    const result: HandlePoint[] = [];
    const body = document.nodes[group.callout.bodyNodeId];
    if (group.callout.parametric && body?.kind === 'shape' && body.shape.kind === 'rect') {
      result.push({
        mode: 'body',
        index: 0,
        point: { x: body.shape.w / 2, y: 0 },
        screenOffset: [26, -22],
        label: 'Move balloon body; keep tail tips anchored',
      });
    }
    tails.forEach((tail, index) => {
      if (tail.style !== 'pointed') return;
      const tailId = tail.nodeIds[0];
      const path = tailId ? document.nodes[tailId] : undefined;
      const tip = calloutTailTip(path);
      const bend = tailId ? calloutTailBendPoint(document, group.id, tailId) : null;
      if (tailId && tip) {
        result.push({
          mode: 'tip',
          tailId,
          index,
          point: { x: tip.x, y: tip.y },
          label: `Move callout tail ${index + 1} point`,
        });
      }
      if (tailId && bend) {
        result.push({
          mode: 'bend',
          tailId,
          index,
          point: bend,
          label: `Bend callout tail ${index + 1}`,
        });
      }
    });
    return result;
  }, [document, editor.state.tool, group, groupWorld, tails]);

  const viewport: Viewport = {
    width: canvasRef.current?.clientWidth ?? 0,
    height: canvasRef.current?.clientHeight ?? 0,
  };
  const camera: Camera = {
    pan: viewportState.pan,
    zoom: viewportState.zoom,
    rotation: viewportState.cameraRotation,
  };
  const toScreen = useCallback(
    (local: { x: number; y: number }): Point => {
      if (!groupWorld) return [0, 0];
      const world = applyAffine(groupWorld, [local.x, local.y]);
      return worldToScreen(camera, world[0], world[1], viewport);
    },
    [camera, groupWorld, viewport],
  );

  const updateFromKeyboard = useCallback(
    (
      mode: HandleMode,
      tailId: string | undefined,
      point: Point,
      event: KeyboardEvent<HTMLButtonElement>,
    ) => {
      const directions: Record<string, Point> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = directions[event.key];
      if (!direction || !group) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = direction[0]! * step;
      const dy = direction[1]! * step;
      const next = { x: point[0] + dx, y: point[1] + dy };
      editor.beginTransaction();
      editor.updateDoc((doc) => {
        if (mode === 'body') return moveCalloutBodyKeepingTailTips(doc, group.id, dx, dy);
        if (!tailId) return doc;
        return mode === 'tip'
          ? updateCalloutTailEndpoint(doc, group.id, tailId, next)
          : updateCalloutTailBendPoint(doc, group.id, tailId, next);
      });
      editor.commitTransaction();
      editor.announceOperation(
        mode === 'body'
          ? 'Move balloon body, keep tail tips anchored'
          : mode === 'tip'
            ? 'Move balloon tail point'
            : 'Bend balloon tail',
        group.name,
      );
    },
    [editor, group],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>, handle: HandlePoint) => {
      if (!group || !groupInverse || isNodeEffectivelyLocked(document, group.id)) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      const canvasLeft = rect?.left ?? 0;
      const canvasTop = rect?.top ?? 0;
      const pointerWorld = screenToWorld(
        camera,
        event.clientX - canvasLeft,
        event.clientY - canvasTop,
        viewport,
      );
      const pointerLocal = applyAffine(groupInverse, pointerWorld);
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode: handle.mode,
        pointerId: event.pointerId,
        groupId: group.id,
        ...(handle.tailId ? { tailId: handle.tailId } : {}),
        groupInverse,
        canvasLeft,
        canvasTop,
        startClient: [event.clientX, event.clientY],
        lastLocal: pointerLocal,
        started: false,
      };
    },
    [camera, canvasRef, document, group, groupInverse, viewport],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !group) return;
      const dxCss = event.clientX - drag.startClient[0];
      const dyCss = event.clientY - drag.startClient[1];
      if (!drag.started) {
        if (Math.hypot(dxCss, dyCss) < DRAG_THRESHOLD_CSS_PX) return;
        editor.beginTransaction();
        drag.started = true;
      }
      const screenX = event.clientX - drag.canvasLeft;
      const screenY = event.clientY - drag.canvasTop;
      const world = screenToWorld(camera, screenX, screenY, viewport);
      const local = applyAffine(drag.groupInverse, world);
      if (drag.mode === 'body') {
        const dx = local[0] - drag.lastLocal[0];
        const dy = local[1] - drag.lastLocal[1];
        drag.lastLocal = local;
        editor.updateDoc((doc) => moveCalloutBodyKeepingTailTips(doc, drag.groupId, dx, dy));
        setPreview(null);
        return;
      }
      if (!drag.tailId) return;
      const tailId = drag.tailId;
      editor.updateDoc((doc) =>
        drag.mode === 'tip'
          ? updateCalloutTailEndpoint(doc, drag.groupId, tailId, { x: local[0], y: local[1] })
          : updateCalloutTailBendPoint(doc, drag.groupId, tailId, {
              x: local[0],
              y: local[1],
            }),
      );
      const fromLocal =
        drag.mode === 'tip'
          ? calloutTailBendPoint(document, drag.groupId, tailId)
          : calloutTailTip(document.nodes[tailId]);
      setPreview({
        groupId: drag.groupId,
        from: fromLocal ? toScreen(fromLocal) : toScreen({ x: local[0], y: local[1] }),
        to: worldToScreen(camera, world[0], world[1], viewport),
      });
    },
    [camera, document, editor, group, toScreen, viewport],
  );

  const finishPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.started) editor.commitTransaction();
      dragRef.current = null;
      setPreview(null);
    },
    [editor],
  );

  const cancelPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.started) editor.abortTransaction();
      dragRef.current = null;
      setPreview(null);
    },
    [editor],
  );

  if (
    !group?.callout.parametric ||
    !groupInverse ||
    editor.state.tool !== 'select' ||
    isNodeEffectivelyLocked(document, group.id) ||
    handles.length === 0
  ) {
    return null;
  }

  return (
    <div
      className="callout-manipulation-overlay"
      role="presentation"
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      style={{ zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX }}
    >
      {preview?.groupId === group.id && (
        <svg className="callout-manipulation-overlay__guide" aria-hidden="true">
          <line
            x1={preview.from[0]}
            y1={preview.from[1]}
            x2={preview.to[0]}
            y2={preview.to[1]}
            className="callout-manipulation-overlay__preview"
          />
        </svg>
      )}
      {handles.map((handle) => {
        const [x, y] = toScreen(handle.point);
        const bend = handle.mode === 'bend';
        const body = handle.mode === 'body';
        const testId = body
          ? 'callout-body-handle'
          : `callout-${handle.mode}-handle-${handle.index + 1}`;
        return (
          <button
            key={`${handle.mode}-${handle.tailId ?? group.id}`}
            type="button"
            className="callout-manipulation-overlay__hit"
            style={{
              left: x + (handle.screenOffset?.[0] ?? 0),
              top: y + (handle.screenOffset?.[1] ?? 0),
            }}
            aria-label={handle.label}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
            data-testid={testId}
            onPointerDown={(event) => handlePointerDown(event, handle)}
            onKeyDown={(event) =>
              updateFromKeyboard(
                handle.mode,
                handle.tailId,
                [handle.point.x, handle.point.y],
                event,
              )
            }
          >
            <span
              aria-hidden="true"
              className={`callout-manipulation-overlay__mark ${body ? 'callout-manipulation-overlay__mark--body' : bend ? 'callout-manipulation-overlay__mark--bend' : 'callout-manipulation-overlay__mark--tip'}`}
            />
          </button>
        );
      })}
    </div>
  );
}
