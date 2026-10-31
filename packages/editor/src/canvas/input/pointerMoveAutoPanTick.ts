/** Auto-pan animation-frame continuation for the pointer-move phase (moved verbatim from handlePointerMove; extracted only to keep the phase module under the 400-line cap). */

import { dispatchToTool } from '../../performance/dispatchSpan';
import { normalizeInputEvent } from '../../tools/inputNormalizer';
import {
  frameDisplacementToVelocity,
  integrateVelocity,
  navigationFrameDeltaMs,
} from '../../tools/navigationPhysics';
import { scheduleCanvasFrame } from '../perfRuntime';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export interface AutoPanFrameTickerParams {
  activeDragPointer: InputLifecyclePhase['activeDragPointer'];
  activeInteractionRecord: InputLifecyclePhase['activeInteractionRecord'];
  autoPanFrameTime: InputLifecyclePhase['autoPanFrameTime'];
  autoPanVelocity: InputLifecyclePhase['autoPanVelocity'];
  buildToolCtx: InputSetupPhase['buildToolCtx'];
  dispatchAttributes: InputGesturePhase['dispatchAttributes'];
  frameKey: string;
  gestureGeneration: number | undefined;
  previewCamera: UseCanvasInputsOptions['previewCamera'];
  stateRef: UseCanvasInputsOptions['stateRef'];
  stopAutoPan: InputLifecyclePhase['stopAutoPan'];
  tmRef: UseCanvasInputsOptions['tmRef'];
}

export function createAutoPanFrameTicker(
  params: AutoPanFrameTickerParams,
): (frameTimeMs: number) => void {
  const {
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
  } = params;

  const tick = (frameTimeMs: number): void => {
    const record = activeInteractionRecord.current;
    if (
      !record ||
      record.closed ||
      record.generation !== gestureGeneration ||
      record.sessionId !== stateRef.current.activeId ||
      record.toolManager !== tmRef.current
    ) {
      stopAutoPan();
      return;
    }
    const v = autoPanVelocity.current;
    if (v.x === 0 && v.y === 0) {
      stopAutoPan();
      return;
    }
    const elapsedMs = navigationFrameDeltaMs(autoPanFrameTime.current, frameTimeMs);
    autoPanFrameTime.current = frameTimeMs;
    const delta = integrateVelocity(
      {
        x: frameDisplacementToVelocity(v.x),
        y: frameDisplacementToVelocity(v.y),
      },
      elapsedMs,
    );
    // Edge velocity describes the direction the artwork should
    // travel under the stationary pointer. Camera pan translates
    // artwork in the opposite screen-space direction, so invert
    // it here (right-edge scrolling moves the camera left).
    previewCamera({
      zoom: stateRef.current.zoom,
      pan: {
        x: stateRef.current.pan.x - delta.x,
        y: stateRef.current.pan.y - delta.y,
      },
      rotation: stateRef.current.cameraRotation,
    });
    const heldPointer = activeDragPointer.current;
    const activeTool = record.toolManager;
    if (heldPointer && activeTool) {
      // Camera motion changes the world point under a stationary
      // edge pointer. Re-sample the active drag after panBy has
      // synchronously advanced stateRef so artwork stays locked
      // to the pointer. Supply only the current authoritative
      // sample: re-reading the event's old coalesced packet would
      // duplicate already-processed drawing input each frame.
      const heldCtx = buildToolCtx(heldPointer, [
        { ...normalizeInputEvent(heldPointer), time: frameTimeMs },
      ]);
      dispatchToTool('move', heldPointer, dispatchAttributes(), () => {
        activeTool.handlePointerMove(heldPointer, heldCtx);
      });
    }
    scheduleCanvasFrame(frameKey, 'input', tick);
  };

  return tick;
}
