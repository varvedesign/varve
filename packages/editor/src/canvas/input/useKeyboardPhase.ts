/** Keydown phase: ownership/IME guard, context menu, space-hand spring, nudge/pan/tool dispatch, Tab/Escape/Enter, and zoom shortcuts (original hook call 57). */

import type { SceneNode } from '@varve/scene';
import { multipageRootNodes } from '@varve/scene';
import { useCallback } from 'react';
import type { CanvasMode } from '../../context/types';
import { eventQueueDelayMs } from '../../performance/clockDomain';
import { beginEditorInteraction } from '../../performance/editorFrameRuntime';
import {
  beginInteraction,
  beginInteractionSpan,
  getActiveInteractionIdentity,
  isInteractionTracingEnabled,
  markInteractionCanvasChanged,
} from '../../performance/interactionTrace';
import {
  keyboardPanDelta,
  shouldDeferArrowToSelectedGuide,
  shouldSkipCanvasKeydown,
} from './keyboardHelpers';
import { applyCanvasZoomShortcuts } from './keyboardZoomShortcuts';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function useKeyboardPhase(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
) {
  const {
    canvasFocusedRef,
    commitCamera,
    contentCanvasRef,
    editor,
    onContextMenu,
    rootNodes,
    setRenameDialog,
    setSnapGuides,
    stateRef,
    tmRef,
  } = options;
  const { buildToolCtx, keyboardEditorInteractionOpen } = setup;
  const {
    activeInteractionRecord,
    cancelCanvasInteraction,
    closePointerEditorInteraction,
    pressedKeyboardKeys,
    stopAutoPan,
  } = lifecycle;
  const { traceEventId } = gesture;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as KeyboardEvent;

      // Canvas key ownership guard: do not run canvas shortcuts when another
      // interaction has already claimed this event, or while the user is
      // composing text. Some IMEs (Windows/IBus) report keydowns on the
      // focused element with `isComposing` false while composition continues;
      // `keyCode === 229` is the "still composing" sentinel many engines use.
      if (shouldSkipCanvasKeydown(ne)) return;

      const keyboardKey = ne.code || ne.key;
      if (!pressedKeyboardKeys.current.has(keyboardKey)) {
        pressedKeyboardKeys.current.add(keyboardKey);
        if (!keyboardEditorInteractionOpen.current) {
          keyboardEditorInteractionOpen.current = true;
          beginEditorInteraction();
        }
      }

      // Keyboard context-menu invocation has no pointer coordinates. Anchor
      // to the selected object's screen-space centre when it is meaningful;
      // otherwise use the focused canvas viewport. The resulting point is
      // explicitly viewport/client space, so canvas zoom never enters the UI
      // placement calculation.
      if (e.key === 'ContextMenu' || e.key === 'Apps' || (e.key === 'F10' && e.shiftKey)) {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        const canvas = contentCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(0, rect.width || canvas.clientWidth);
        const height = Math.max(0, rect.height || canvas.clientHeight);
        let localX = width / 2;
        let localY = height / 2;
        const selectedId = stateRef.current.selection[0];
        const selectedBounds = selectedId ? editor.getWorldBounds(selectedId) : null;
        if (selectedBounds) {
          const selectedPoint = editor.worldToCanvas(
            selectedBounds.x + selectedBounds.w / 2,
            selectedBounds.y + selectedBounds.h / 2,
          );
          if (Number.isFinite(selectedPoint.x) && Number.isFinite(selectedPoint.y)) {
            localX = selectedPoint.x;
            localY = selectedPoint.y;
          }
        }
        const margin = 8;
        const clampInside = (value: number, start: number, end: number): number => {
          if (end <= start) return start;
          return Math.min(Math.max(start + margin, value), end - margin);
        };
        const x = clampInside(rect.left + localX, rect.left, rect.right);
        const y = clampInside(rect.top + localY, rect.top, rect.bottom);
        onContextMenu({
          point: { space: 'viewport', x, y },
          contextElement: canvas,
        });
        return;
      }

      const tmInst = tmRef.current;
      const activeTrace = isInteractionTracingEnabled() ? getActiveInteractionIdentity() : null;
      const keyboardHandlerStartedAt = performance.now();
      if (isInteractionTracingEnabled() && activeTrace === null) {
        beginInteraction('keyboard', ne.timeStamp);
      }
      if (isInteractionTracingEnabled()) {
        const eventSequenceId = traceEventId('keyboard');
        const queueDelayMs = eventQueueDelayMs(ne.timeStamp, keyboardHandlerStartedAt);
        const finishKeyboardInput = beginInteractionSpan('keyboard.input', {
          repeat: e.repeat,
          modifiers: Number(e.shiftKey) + Number(e.ctrlKey) + Number(e.altKey) + Number(e.metaKey),
          ...(Number.isFinite(ne.timeStamp) ? { eventTimeStamp: ne.timeStamp } : {}),
          ...(queueDelayMs === null
            ? { queueDelayClock: 'untrusted' }
            : {
                queueDelayMs,
                queueDelayClock: 'dom.event.timeStamp',
              }),
          ...(eventSequenceId ? { eventSequenceId } : {}),
        });
        queueMicrotask(finishKeyboardInput);
      }

      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && tmInst) {
          if (activeInteractionRecord.current) cancelCanvasInteraction();
          tmInst.springLoadTool(
            'hand',
            ne,
            buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent),
          );
        }
        return;
      }

      // Arrow keys pan only in an explicit navigation context: the Hand tool
      // or while Space has armed its temporary Hand tool. Selection, text,
      // sliders, trees, and specialized tools retain their normal Arrow
      // ownership. Values are CSS pixels, so zoom never changes the user's
      // keyboard travel.
      const panDelta = keyboardPanDelta(e.key, e.shiftKey);
      if (
        panDelta &&
        tmInst &&
        (tmInst.activeToolId === 'hand' || tmInst.springActive) &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        editor.panBy(panDelta.dx, panDelta.dy);
        markInteractionCanvasChanged();
        return;
      }

      if (tmInst) {
        if (
          shouldDeferArrowToSelectedGuide({
            key: e.key,
            selectedGuideId: stateRef.current.selectedGuideId,
            activeToolId: tmInst.activeToolId,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
          })
        ) {
          return;
        }
        const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
        if (tmInst.handleKeyDown(ne, ctx)) {
          e.preventDefault();
          markInteractionCanvasChanged();
          return;
        }
      }

      const s = stateRef.current;
      const eRef = editor;

      // Paint-order DFS walk of the document. It is O(n) per keydown and only
      // the Tab and Enter/F2 branches consume it, so it is built lazily on
      // first use instead of for every keystroke (arrow nudges, modifiers).
      const selArr = s.selection;
      const firstSel = selArr[0] ?? null;
      let paintOrderCache: { nodes: SceneNode[]; idx: number } | null = null;
      const paintOrder = (): { nodes: SceneNode[]; idx: number } => {
        if (paintOrderCache) return paintOrderCache;
        const nodes: SceneNode[] = [];
        const doc = s.document;
        const walkIds = (ids: readonly string[]) => {
          for (const id of ids) {
            const n = doc.nodes[id];
            if (!n) continue;
            nodes.push(n);
            if ('children' in n && n.children && n.children.length > 0) {
              walkIds(n.children);
            }
          }
        };
        // Select only the roots rendered on the current editing surface.
        // Surface content-root groups are persistence containers, not user
        // objects: including them made Tab select a hidden Design Canvas root
        // that has no corresponding Layers row.
        walkIds(
          multipageRootNodes(doc, {
            masterEditId: s.masterEditId,
            designCanvasId: s.workspaceMode === 'print' ? null : doc.activeDesignCanvasId,
          }),
        );
        const idx = firstSel ? nodes.findIndex((n) => n.id === firstSel) : -1;
        paintOrderCache = { nodes, idx };
        return paintOrderCache;
      };

      if (e.key === 'Tab') {
        // Canvas Tab contract (docs/audits/focus-navigation-audit-2026-08-02.md):
        // with a selection, Tab/Shift+Tab cycle selection through the design
        // objects (industry-standard for design tools). With no selection,
        // Tab falls through to normal focus navigation so the canvas is
        // never a hard keyboard trap — Escape clears selection, then Tab
        // leaves the canvas for the next region.
        //
        // When focus arrives from outside the canvas (e.g. Shift+Tab from
        // the layers panel), canvasFocusedRef is still false because focus
        // moved to the canvas *before* this keydown fired. In that case,
        // let Tab fall through for normal browser focus navigation so the
        // user can keep moving backward/forward through the editor regions.
        if (canvasFocusedRef && !canvasFocusedRef.current) return;
        if (selArr.length === 0) return;
        e.preventDefault();
        const { nodes, idx } = paintOrder();
        if (e.shiftKey) {
          const prev = nodes[(idx <= 0 ? nodes.length : idx) - 1];
          if (prev) {
            eRef.setSelection(prev.id);
            eRef.announceSelection([prev]);
            markInteractionCanvasChanged();
          }
        } else {
          const next = nodes[(idx + 1) % nodes.length];
          if (next) {
            eRef.setSelection(next.id);
            eRef.announceSelection([next]);
            markInteractionCanvasChanged();
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        // B5: Cancel any active tool drag before clearing selection.
        // Tools that handle Escape in their own onKeyDown return true,
        // which preventDefaults and returns above (tmInst.handleKeyDown).
        // If we reach here, the tool did not consume Escape — cancel the
        // drag explicitly so it cannot remain stuck.
        if (tmInst) {
          const cancelCtx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
          tmInst.handlePointerCancel(new PointerEvent('pointercancel'), cancelCtx);
        }
        stopAutoPan();
        setSnapGuides([]);
        if (s.isolatedNodeId) {
          eRef.exitIsolation();
          eRef.setSelection(s.isolatedNodeId);
          eRef.announceOperation('Exit isolation', 'Clipping group');
          markInteractionCanvasChanged();
          return;
        }
        eRef.setSelection(null);
        eRef.announceSelection([]);
        markInteractionCanvasChanged();
        if ((s as { canvasMode?: string }).canvasMode !== 'full') {
          (eRef as { setCanvasMode: (m: CanvasMode) => void }).setCanvasMode('full');
        }
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        setRenameDialog({ defaultValue: paintOrder().nodes[paintOrder().idx]?.name ?? '' });
      }

      applyCanvasZoomShortcuts({
        e,
        editor,
        eRef,
        selArr,
        stateRef,
        contentCanvasRef,
        commitCamera,
        rootNodes,
        markInteractionCanvasChanged,
      });
    },
    [
      onContextMenu,
      tmRef,
      buildToolCtx,
      stateRef,
      editor,
      commitCamera,
      contentCanvasRef,
      setRenameDialog,
      rootNodes,
      stopAutoPan,
      setSnapGuides,
      closePointerEditorInteraction,
      cancelCanvasInteraction,
    ],
  );

  return { handleKeyDown };
}
