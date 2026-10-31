/** Viewport zoom/placement helpers used by the native wheel, gesture, and pinch-bridge runtimes (moved verbatim from the native listener effect). */

import {
  clampZoom,
  computeFloatingOrigin,
  placeWorldPointAtScreen,
  screenToWorld,
  zoomAboutPoint,
} from '@varve/shared';
import type { UseCanvasInputsOptions } from './types';

export interface NativeZoomPlacementDeps {
  canvasRectRef: UseCanvasInputsOptions['canvasRectRef'];
  contentCanvasRef: UseCanvasInputsOptions['contentCanvasRef'];
  previewCamera: UseCanvasInputsOptions['previewCamera'];
  stateRef: UseCanvasInputsOptions['stateRef'];
}

export function zoomAboutClientPoint(
  deps: NativeZoomPlacementDeps,
  clientX: number,
  clientY: number,
  newZoom: number,
): void {
  const { canvasRectRef, contentCanvasRef, previewCamera, stateRef } = deps;

  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !Number.isFinite(newZoom)) return;
  const s = stateRef.current;
  const rect = canvasRectRef.current;
  const canvasEl = contentCanvasRef.current;
  const viewport = {
    width: canvasEl?.clientWidth ?? 800,
    height: canvasEl?.clientHeight ?? 600,
  };
  if (viewport.width <= 0 || viewport.height <= 0) return;
  const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
  const origin = computeFloatingOrigin(cam, viewport);
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const anchor = screenToWorld(cam, clientX - left, clientY - top, viewport, origin);
  const newCam = zoomAboutPoint(cam, anchor, clampZoom(newZoom), viewport);
  previewCamera(newCam);
}

export function placeWorldAnchorAtClientPoint(
  deps: NativeZoomPlacementDeps,
  worldAnchor: [number, number],
  clientX: number,
  clientY: number,
  newZoom: number,
): void {
  const { canvasRectRef, contentCanvasRef, previewCamera, stateRef } = deps;

  if (
    !Number.isFinite(worldAnchor[0]) ||
    !Number.isFinite(worldAnchor[1]) ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(newZoom)
  ) {
    return;
  }
  const s = stateRef.current;
  const rect = canvasRectRef.current;
  const canvasEl = contentCanvasRef.current;
  const viewport = {
    width: canvasEl?.clientWidth ?? 800,
    height: canvasEl?.clientHeight ?? 600,
  };
  if (viewport.width <= 0 || viewport.height <= 0) return;
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
  const next = placeWorldPointAtScreen(
    cam,
    worldAnchor,
    [clientX - left, clientY - top],
    clampZoom(newZoom),
    viewport,
  );
  previewCamera(next);
}
