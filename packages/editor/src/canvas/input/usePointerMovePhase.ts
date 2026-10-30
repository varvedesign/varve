/** Pointer-move phase: navigation/pinch, hover, cursor publishing, auto-pan, and the move tool dispatch (original hook call 51). */

import type { Camera } from '@varve/shared';
import {
  clampZoom,
  computeFloatingOrigin,
  rotateAboutScreenPoint,
  screenToWorld,
  zoomAboutPoint,
} from '@varve/shared';
import { useCallback } from 'react';
import { eventQueueDelayMs } from '../../performance/clockDomain';
import { dispatchToTool } from '../../performance/dispatchSpan';
import {
  beginInteraction,
  endInteractionIfKind,
  getActiveInteractionIdentity,
  isInteractionTracingEnabled,
  markInteractionCanvasChanged,
  recordInteractionEventSample,
  recordInteractionSpan,
} from '../../performance/interactionTrace';
import { computeEdgeVelocity } from '../../tools/autoPan';
import { collectSourceEvents, observeInputCapabilities } from '../../tools/inputNormalizer';
import {
  endPointerContact,
  getPointerContact,
  updatePointerContact,
} from '../../tools/inputPolicy';
import { publishCursorWorldPosition } from '../cursorPosition';
import { getNavigationSettings } from '../navigationRuntime';
import { scheduleCanvasFrame } from '../perfRuntime';
import { createAutoPanFrameTicker } from './pointerMoveAutoPanTick';
import {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  isTouchLikePointerType,
  ownsCanvasPointerInteraction,
  shouldResolveHover,
  snapshotHeldPointer,
} from './primitives';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function usePointerMovePhase(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
) {
  const {
    canvasRectRef,
    commitCamera,
    contentCanvasRef,
    editor,
    previewCamera,
    setHoveredNode,
    setSnapGuides,
    stateRef,
    tmRef,
  } = options;
  const { buildToolCtx, pointerOwnershipRef, setViewportAnchor, touchPointers } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    autoPanActive,
    autoPanFrameKey,
    autoPanFrameTime,
    autoPanVelocity,
    closePointerEditorInteraction,
    hoverTraceEndTimer,
    lastHoverTraceAt,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    stopAutoPan,
  } = lifecycle;
  const { cursorRafScheduled, dispatchAttributes, latestCursorWorld, traceEventId } = gesture;

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as PointerEvent;
      if (nativeGestureRef.current && isTouchLikePointerType(e.pointerType)) {
        e.preventDefault();
        return;
      }
      if (e.pointerType === 'pen') observeInputCapabilities(ne);
      const trackedMove = updatePointerContact(
        pointerOwnershipRef.current,
        e.pointerId,
        e.clientX,
        e.clientY,
      );
      const contact =
        trackedMove?.contact ?? getPointerContact(pointerOwnershipRef.current, e.pointerId);

      if (contact?.role === 'ignored') {
        e.preventDefault();
        return;
      }

      if (
        contact?.role === 'tool' &&
        !ownsCanvasPointerInteraction(
          activeInteractionRecord.current,
          e.pointerId,
          stateRef.current.activeId,
          tmRef.current,
        )
      ) {
        const record = activeInteractionRecord.current;
        if (record && !record.closed && record.pointerId === e.pointerId) {
          cancelRecordedCanvasPointer(record, ne);
          activeInteractionRecord.current = null;
          activeDragPointer.current = null;
          stopAutoPan();
          setSnapGuides([]);
          closePointerEditorInteraction();
          endPointerContact(pointerOwnershipRef.current, e.pointerId);
        }
        e.preventDefault();
        return;
      }

      if (contact?.role === 'navigation') {
        e.preventDefault();
        if (isTouchLikeContact(contact)) {
          touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          advanceNavigation({
            type: 'pointer-move',
            pointerType: 'touch',
            pointerCount: touchPointers.current.size,
          });
        }
        const pinch = pinchRef.current;
        const geo = pinchGeometry();
        if (pinch && geo) {
          setViewportAnchor(geo.centroid.x, geo.centroid.y);
          const s = stateRef.current;
          const canvasRect = canvasRectRef.current;
          const el = contentCanvasRef.current;
          const canvasW = el?.clientWidth ?? 1920;
          const canvasH = el?.clientHeight ?? 1080;
          const viewport = { width: canvasW, height: canvasH };
          const left = Number.isFinite(canvasRect.left) ? canvasRect.left : 0;
          const top = Number.isFinite(canvasRect.top) ? canvasRect.top : 0;

          // Twist rotates the view about the gesture centroid first; pan and
          // zoom then compose on the rotated base. With the setting off or
          // the dead zone uncrossed the fed delta is 0 and the base stays
          // bit-identical to the pre-twist camera, so plain pinching is
          // unchanged.
          let base: Camera = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
          if (getNavigationSettings().twistRotationEnabled && pinch.lastAngle !== null) {
            const twistDelta = pinch.twist.feed(geo.angle - pinch.lastAngle);
            if (twistDelta !== 0) {
              base = rotateAboutScreenPoint(
                base,
                [geo.centroid.x - left, geo.centroid.y - top],
                twistDelta,
                viewport,
              );
            }
          }
          pinch.lastAngle = geo.angle;

          const panned = {
            x: base.pan.x + (geo.centroid.x - pinch.lastCentroid.x),
            y: base.pan.y + (geo.centroid.y - pinch.lastCentroid.y),
          };
          const cam = { pan: panned, zoom: base.zoom, rotation: base.rotation };
          const origin = computeFloatingOrigin(cam, viewport);
          const anchor = screenToWorld(
            cam,
            geo.centroid.x - left,
            geo.centroid.y - top,
            viewport,
            origin,
          );
          const factor = pinch.lastDist > 0 ? geo.dist / pinch.lastDist : 1;
          const newCam = zoomAboutPoint(cam, anchor, clampZoom(base.zoom * factor), viewport);
          previewCamera(newCam);
          markInteractionCanvasChanged();
          pinchRef.current = {
            lastDist: geo.dist,
            lastCentroid: geo.centroid,
            lastAngle: geo.angle,
            twist: pinch.twist,
          };
        } else if (trackedMove) {
          // One-finger navigation is opt-in and has no tool/history side
          // effects. The delta is already in CSS pixels, matching camera pan.
          previewCamera({
            zoom: stateRef.current.zoom,
            pan: {
              x: stateRef.current.pan.x + trackedMove.dx,
              y: stateRef.current.pan.y + trackedMove.dy,
            },
            rotation: stateRef.current.cameraRotation,
          });
          markInteractionCanvasChanged();
          setViewportAnchor(e.clientX, e.clientY);
        }
        return;
      }

      // A button-bearing event with no registered owner is a stale or
      // compatibility event. Do not let it create a second stroke.
      if (e.buttons !== 0 && contact?.role !== 'tool') return;
      if (e.buttons !== 0 && !contact) return;
      const sourceEvents = collectSourceEvents(ne, true);
      const ctx = buildToolCtx(ne, sourceEvents);
      if (contact?.role === 'tool' && e.buttons !== 0) {
        if (isTouchLikeContact(contact) && touchPointers.current.has(e.pointerId)) {
          touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        activeDragPointer.current = snapshotHeldPointer(ne);
        setViewportAnchor(e.clientX, e.clientY);
      }

      const traceOn = isInteractionTracingEnabled();
      const traceStart = traceOn ? performance.now() : 0;
      const eventSequenceId = traceOn ? traceEventId('pointer') : undefined;
      const activeTrace = traceOn ? getActiveInteractionIdentity() : null;
      if (traceOn) {
        // Preserve queue evidence for confirmed coalesced samples without
        // counting them as additional handler invocations. The primary
        // sample remains represented by pointer.input below.
        const confirmed = sourceEvents.filter((sample) => !sample.isPredicted);
        for (const sample of confirmed.slice(0, Math.max(0, confirmed.length - 1))) {
          recordInteractionEventSample(
            'pointer.coalesced',
            sample.time,
            traceEventId('pointer-coalesced'),
            sample.timestampTrusted !== false,
          );
        }
      }
      // Hover-only movement is sampled at 800 ms so idle pointer motion does
      // not churn the trace ring while hover latency stays measurable.
      if (
        traceOn &&
        e.buttons === 0 &&
        activeTrace === null &&
        (lastHoverTraceAt.current === 0 || traceStart - lastHoverTraceAt.current > 800)
      ) {
        lastHoverTraceAt.current = traceStart;
        beginInteraction('hover', ne.timeStamp);
      }
      const traceFinish = () => {
        if (traceOn) {
          const queueDelayMs = eventQueueDelayMs(ne.timeStamp, traceStart);
          recordInteractionSpan('pointer.input', performance.now() - traceStart, {
            pointerType: e.pointerType,
            buttons: e.buttons,
            ...(Number.isFinite(ne.timeStamp) ? { eventTimeStamp: ne.timeStamp } : {}),
            ...(eventSequenceId ? { eventSequenceId } : {}),
            ...(queueDelayMs === null
              ? { queueDelayClock: 'untrusted' }
              : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
          });
          if (getActiveInteractionIdentity()?.kind === 'hover') {
            if (hoverTraceEndTimer.current !== null) clearTimeout(hoverTraceEndTimer.current);
            hoverTraceEndTimer.current = setTimeout(() => {
              hoverTraceEndTimer.current = null;
              endInteractionIfKind('hover');
            }, 100);
          }
        }
      };

      // Frame-scheduled cursor update: latest input wins, at most one
      // update per animation frame. Replaces the old 32ms fixed throttle
      // which ran at ~31 Hz regardless of display refresh rate (task brief §6).
      // Published to the cursor store, never EditorState: a per-frame state
      // patch re-rendered every editor consumer while the pointer only hovered.
      const world = ctx.canvasToWorld(e.clientX, e.clientY);
      latestCursorWorld.current = world;
      if (!cursorRafScheduled.current) {
        cursorRafScheduled.current = true;
        requestAnimationFrame(() => {
          cursorRafScheduled.current = false;
          const pos = latestCursorWorld.current;
          if (pos) publishCursorWorldPosition(pos);
        });
      }

      const tmInst = tmRef.current;
      if (!tmInst) {
        traceFinish();
        return;
      }

      // Show hover preview for both select and inspect tools.
      // For other tools, keep the inspect-only behavior (or none at all).
      if (shouldResolveHover(stateRef.current.tool, e.buttons)) {
        const world = ctx.canvasToWorld(ne.clientX, ne.clientY);
        const hit = editor.hitTestNode(world);
        setHoveredNode(hit?.node ?? null);
      }

      dispatchToTool('move', ne, dispatchAttributes(), () => {
        tmInst.handlePointerMove(ne, ctx);
      });
      if (e.buttons !== 0) markInteractionCanvasChanged();

      if (e.buttons !== 0) {
        const rect = canvasRectRef.current;
        const canvasEl = contentCanvasRef.current;
        const vx = computeEdgeVelocity(
          e.clientX,
          rect.left,
          rect.left + (canvasEl?.clientWidth ?? 0),
        );
        const vy = computeEdgeVelocity(
          e.clientY,
          rect.top,
          rect.top + (canvasEl?.clientHeight ?? 0),
        );
        autoPanVelocity.current = { x: vx, y: vy };
        if (vx !== 0 || vy !== 0) {
          if (!autoPanActive.current) {
            const frameKey = autoPanFrameKey.current;
            if (!frameKey) return;
            const gestureGeneration = activeInteractionRecord.current?.generation;
            autoPanActive.current = true;
            const tick = createAutoPanFrameTicker({
              activeDragPointer,
              activeInteractionRecord,
              autoPanFrameTime,
              autoPanVelocity,
              buildToolCtx,
              dispatchAttributes,
              frameKey,
              gestureGeneration,
              previewCamera,
              stateRef,
              stopAutoPan,
              tmRef,
            });
            scheduleCanvasFrame(frameKey, 'input', tick);
          }
        } else {
          stopAutoPan();
        }
      } else {
        stopAutoPan();
      }
      traceFinish();
    },
    [
      tmRef,
      stateRef,
      contentCanvasRef,
      editor,
      commitCamera,
      previewCamera,
      buildToolCtx,
      setHoveredNode,
      stopAutoPan,
      setSnapGuides,
      closePointerEditorInteraction,
      dispatchAttributes,
      traceEventId,
    ],
  );

  return { handlePointerMove };
}
