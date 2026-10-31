/** Zoom-preset, fit-all, and fit-selection keyboard shortcuts (moved verbatim from handleKeyDown; early returns keep their handler-return effect). */

import {
  clampZoom,
  computeFloatingOrigin,
  fitBoundsCameraWithRotation,
  screenToWorld,
  zoomAboutPoint,
} from '@varve/shared';
import { physicalDigit } from '../../input/physicalKey';
import type { UseCanvasInputsOptions } from './types';

export interface CanvasZoomShortcutParams {
  e: React.KeyboardEvent<HTMLCanvasElement>;
  editor: UseCanvasInputsOptions['editor'];
  eRef: UseCanvasInputsOptions['editor'];
  selArr: UseCanvasInputsOptions['stateRef']['current']['selection'];
  stateRef: UseCanvasInputsOptions['stateRef'];
  contentCanvasRef: UseCanvasInputsOptions['contentCanvasRef'];
  commitCamera: UseCanvasInputsOptions['commitCamera'];
  rootNodes: UseCanvasInputsOptions['rootNodes'];
  markInteractionCanvasChanged: () => void;
}

export function applyCanvasZoomShortcuts(params: CanvasZoomShortcutParams): void {
  const {
    e,
    editor,
    eRef,
    selArr,
    stateRef,
    contentCanvasRef,
    commitCamera,
    rootNodes,
    markInteractionCanvasChanged,
  } = params;

  function zoomAboutCanvasCentre(newZoom: number) {
    const s2 = stateRef.current;
    const parent = contentCanvasRef.current?.parentElement;
    const vpW = parent?.clientWidth ?? 800;
    const vpH = parent?.clientHeight ?? 600;
    const viewport = { width: vpW, height: vpH };
    const cam = { pan: s2.pan, zoom: s2.zoom, rotation: s2.cameraRotation };
    const origin = computeFloatingOrigin(cam, viewport);
    const centreWorld = screenToWorld(cam, vpW / 2, vpH / 2, viewport, origin);
    const newCam = zoomAboutPoint(cam, centreWorld, newZoom, viewport);
    commitCamera(newCam);
  }

  const ZOOM_PRESETS: Record<string, number> = {
    '1': 0.5,
    '2': 0.75,
    '3': 1,
    '4': 1.5,
    '5': 2,
    '6': 4,
  };
  // Digits resolved from the physical key (`Digit1`/`Numpad1`), so the
  // preset/fit shortcuts work on real layouts where `Shift+1` reports
  // `key='!'`, and on numpads regardless of NumLock.
  const digit = physicalDigit({ key: e.key, code: e.code });

  if (digit !== null && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const zoomLevel = ZOOM_PRESETS[digit];
    if (zoomLevel !== undefined) {
      e.preventDefault();
      zoomAboutCanvasCentre(zoomLevel);
      markInteractionCanvasChanged();
      eRef.announceOperation('Zoom', `${Math.round(zoomLevel * 100)}%`);
      return;
    }
  }

  if (digit === '0' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    e.preventDefault();
    zoomAboutCanvasCentre(1);
    markInteractionCanvasChanged();
    eRef.announceOperation('Zoom', '100%');
    return;
  }

  if ((e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') && !e.altKey) {
    e.preventDefault();
    zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 1.25));
    markInteractionCanvasChanged();
    eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
    return;
  }
  if ((e.key === '-' || e.code === 'NumpadSubtract') && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 0.8));
    markInteractionCanvasChanged();
    eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
    return;
  }

  if (digit === '1' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const parent = contentCanvasRef.current?.parentElement;
    const vpW = parent?.clientWidth ?? 800;
    const vpH = parent?.clientHeight ?? 600;
    const canvasViewport = { width: vpW, height: vpH };
    const allBounds = rootNodes().reduce<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>((acc, n) => {
      const b = editor.getWorldBounds(n.id);
      if (!b) return acc;
      if (!acc) return b;
      return {
        x: Math.min(acc.x, b.x),
        y: Math.min(acc.y, b.y),
        w: Math.max(acc.x + acc.w, b.x + b.w) - Math.min(acc.x, b.x),
        h: Math.max(acc.y + acc.h, b.y + b.h) - Math.min(acc.y, b.y),
      };
    }, null);
    if (allBounds) {
      const cam = fitBoundsCameraWithRotation(
        allBounds,
        canvasViewport,
        stateRef.current.cameraRotation,
        40,
      );
      commitCamera(cam);
      markInteractionCanvasChanged();
      eRef.announceOperation('Zoom', 'fit all');
    }
  }
  if (digit === '2' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (selArr.length > 0) {
      const parent = contentCanvasRef.current?.parentElement;
      const viewport = parent
        ? { width: parent.clientWidth, height: parent.clientHeight }
        : undefined;
      eRef.revealSelection({ fit: true, viewport });
      markInteractionCanvasChanged();
      eRef.announceOperation('Zoom', 'to selection');
    }
  }
}
