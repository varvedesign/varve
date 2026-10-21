/**
 * One undo step per continuous control gesture.
 *
 * `updateDoc` pushes an undo entry for every call made while no transaction is
 * open (see `context.tsx` → `updateDoc`). A native range input emits a change
 * event per pointer move, so a control that writes the document from its
 * `onChange` would otherwise push one entry per pixel of travel: `Ctrl+Z` then
 * walks back through dozens of intermediate values instead of reverting the
 * gesture, and the 50-entry history window is consumed by a single drag.
 *
 * Several surfaces had grown their own copy of this bookkeeping
 * (`AdjustmentPanel`, `SmartFiltersSection`, `EffectStudioSection`,
 * `PathTextSection`, `GradientMapEditor`, `NumberField`). This hook is the
 * shared form so a new control opts in with one spread rather than
 * re-deriving the begin/commit rules — and so the rules stay the same
 * everywhere.
 *
 * Contract:
 * - Pointer: begin on the first primary-button `pointerdown`, commit on
 *   `pointerup` **and** `pointercancel`. The element keeps pointer capture for
 *   the duration so a release outside the control still commits.
 * - Keyboard: begin on the first stepping key, commit on `keyup`. Key repeats
 *   (`event.repeat`) never open a second transaction. `keyup` and `blur` are
 *   observed on the window, not the element: a range input that loses focus
 *   mid-burst would otherwise never report its release and the transaction
 *   would stay open, silently merging every later edit into the same undo
 *   step.
 * - Escape aborts the gesture and restores the pre-gesture document, matching
 *   the numeric-field scrub and drag-handle conventions.
 * - Unmount commits. A control unmounted mid-gesture (a panel switching away)
 *   must not strand an open transaction, and the edits the user already made
 *   are real edits.
 *
 * Deliberately not time-based: a merge window would also fuse two separate,
 * intentional edits made in quick succession. Gesture boundaries are what the
 * user perceives as one action.
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * The transaction subset of `EditorContextValue`. Structural so the hook can be
 * used and tested without the full editor context.
 */
export interface GestureTransactionHost {
  beginTransaction: (mode?: 'edit' | 'preview') => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
}

/** Keys a native range input consumes as a value step. */
const RANGE_STEP_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Handlers to spread onto a `RangeValueControl`. */
export interface RangeGestureProps {
  onRangePointerDown: React.PointerEventHandler<HTMLInputElement>;
  onRangePointerUp: React.PointerEventHandler<HTMLInputElement>;
  onRangePointerCancel: React.PointerEventHandler<HTMLInputElement>;
  onRangeKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  onRangeKeyUp: React.KeyboardEventHandler<HTMLInputElement>;
}

export interface GestureTransaction {
  /** Open the gesture transaction. Idempotent within a gesture. */
  begin: () => void;
  /** Close the gesture transaction, recording one undo entry. Idempotent. */
  commit: () => void;
  /** Discard the gesture, restoring the pre-gesture document. Idempotent. */
  abort: () => void;
  /** Whether a gesture transaction is currently open. */
  isActive: () => boolean;
  /** Ready-made handlers for `RangeValueControl`. */
  rangeProps: RangeGestureProps;
}

/**
 * @param host Transaction functions, normally the editor context value.
 * @param options.enabled When false the gesture is never opened and the
 *   document write path is left exactly as it was. Use for controls that are
 *   disabled or read-only in the current state.
 */
export function useGestureTransaction(
  host: GestureTransactionHost,
  options: { enabled?: boolean } = {},
): GestureTransaction {
  const enabled = options.enabled ?? true;
  const activeRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Read through a ref so a re-render mid-gesture cannot change which
  // transaction the gesture closes.
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
  }, [host]);

  const detachListeners = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const begin = useCallback(() => {
    if (!enabled || activeRef.current) return;
    activeRef.current = true;
    hostRef.current.beginTransaction('edit');
  }, [enabled]);

  const commit = useCallback(() => {
    detachListeners();
    if (!activeRef.current) return;
    activeRef.current = false;
    hostRef.current.commitTransaction();
  }, [detachListeners]);

  const abort = useCallback(() => {
    detachListeners();
    if (!activeRef.current) return;
    activeRef.current = false;
    hostRef.current.abortTransaction();
  }, [detachListeners]);

  const isActive = useCallback(() => activeRef.current, []);

  // A keyboard burst ends on a window-level keyup/blur: the range input may
  // not receive either once focus moves.
  const watchKeyboardRelease = useCallback(() => {
    if (cleanupRef.current) return;
    const onKeyUp = (event: KeyboardEvent) => {
      if (RANGE_STEP_KEYS.has(event.key) || event.key === 'Escape') {
        if (event.key === 'Escape') abort();
        else commit();
      }
    };
    const onBlur = () => commit();
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    cleanupRef.current = () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [abort, commit]);

  const onRangePointerDown = useCallback<React.PointerEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.button !== 0) return;
      // Keep the gesture alive when the pointer leaves the control.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort: a browser without it still commits on the
        // element's own pointerup.
      }
      begin();
    },
    [begin],
  );

  const releaseCapture = useCallback((event: React.PointerEvent<HTMLInputElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }, []);

  const onRangePointerUp = useCallback<React.PointerEventHandler<HTMLInputElement>>(
    (event) => {
      releaseCapture(event);
      commit();
    },
    [commit, releaseCapture],
  );

  const onRangePointerCancel = useCallback<React.PointerEventHandler<HTMLInputElement>>(
    (event) => {
      releaseCapture(event);
      // A cancelled pointer is an interrupted gesture, but the value changes it
      // already applied are visible on screen. Committing keeps the screen and
      // the history in agreement; aborting would silently revert a change the
      // user can still see.
      commit();
    },
    [commit, releaseCapture],
  );

  const onRangeKeyDown = useCallback<React.KeyboardEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.key === 'Escape') {
        abort();
        return;
      }
      if (!RANGE_STEP_KEYS.has(event.key)) return;
      begin();
      watchKeyboardRelease();
    },
    [abort, begin, watchKeyboardRelease],
  );

  const onRangeKeyUp = useCallback<React.KeyboardEventHandler<HTMLInputElement>>(
    (event) => {
      if (RANGE_STEP_KEYS.has(event.key)) commit();
    },
    [commit],
  );

  // Unmount mid-gesture must not strand an open transaction.
  useEffect(
    () => () => {
      detachListeners();
      if (activeRef.current) {
        activeRef.current = false;
        hostRef.current.commitTransaction();
      }
    },
    [detachListeners],
  );

  const rangeProps = useMemo<RangeGestureProps>(
    () => ({
      onRangePointerDown,
      onRangePointerUp,
      onRangePointerCancel,
      onRangeKeyDown,
      onRangeKeyUp,
    }),
    [onRangeKeyDown, onRangeKeyUp, onRangePointerCancel, onRangePointerDown, onRangePointerUp],
  );

  return useMemo(
    () => ({ begin, commit, abort, isActive, rangeProps }),
    [abort, begin, commit, isActive, rangeProps],
  );
}
