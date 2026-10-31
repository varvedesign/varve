/** Input gesture dispatch attributes phase: snap-session fallbacks, cursor-frame refs, and dispatch/trace attributes (hooks 43-49). */

import { useCallback, useRef } from 'react';
import {
  getActiveInteractionIdentity,
  isInteractionTracingEnabled,
  nextPointerSequenceId,
} from '../../performance/interactionTrace';
import { createSnapSession } from '../../tools/snapping';
import type { UseCanvasInputsOptions } from './types';

export function useGestureDispatchRuntime(options: UseCanvasInputsOptions) {
  const {
    snapIndexRef: externalSnapIndexRef,
    snapSessionRef: externalSnapSessionRef,
    stateRef,
  } = options;

  const internalSnapSessionRef = useRef(createSnapSession());
  const internalSnapIndexRef = useRef<{
    index: unknown;
    parentIndex: Map<string, string>;
    documentId: string;
  } | null>(null);
  const snapSessionForPointer = externalSnapSessionRef ?? internalSnapSessionRef;
  const snapIndexForPointer = externalSnapIndexRef ?? internalSnapIndexRef;
  const cursorRafScheduled = useRef(false);
  const latestCursorWorld = useRef<{ x: number; y: number } | null>(null);
  // Document size is O(n) to measure, so it is sampled once per gesture (only
  // while tracing) and reused for every event's dispatch attributes rather
  // than recomputed per pointermove.
  const gestureComplexity = useRef('unknown');

  const dispatchAttributes = useCallback(
    () => ({
      tool: stateRef.current.tool,
      docComplexity: gestureComplexity.current,
      selectionCount: stateRef.current.selection.length,
    }),
    [stateRef],
  );

  const traceEventId = useCallback((kind: string): string | undefined => {
    if (!isInteractionTracingEnabled()) return undefined;
    const identity = getActiveInteractionIdentity();
    const sequence = nextPointerSequenceId();
    if (!identity) return `${kind}:handler:${sequence}`;
    return sequence === 1 ? 'initial' : `${identity.interactionId}:${sequence}`;
  }, []);

  return {
    cursorRafScheduled,
    dispatchAttributes,
    gestureComplexity,
    latestCursorWorld,
    snapIndexForPointer,
    snapSessionForPointer,
    traceEventId,
  };
}

export type InputGesturePhase = ReturnType<typeof useGestureDispatchRuntime>;
