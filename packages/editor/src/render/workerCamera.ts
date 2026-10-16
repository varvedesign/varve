/**
 * Apply the same camera contract in the render worker as on the main thread.
 * Keeping this pure makes rotation, zoom, pan, DPR, and future camera changes
 * independently testable without booting a Worker global.
 */

import type { Affine, Camera, Viewport } from '@varve/shared';
import {
  applyCameraTransform,
  buildWorldToScreenAffine,
  computeFloatingOrigin,
  multiplyAffine,
  tryInvertAffine,
} from '@varve/shared';

export interface WorkerCameraTarget {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
}

export function applyWorkerCamera(
  target: WorkerCameraTarget,
  camera: Camera,
  dpr: number,
  viewport: Viewport,
): void {
  applyCameraTransform(target, camera, dpr, viewport, computeFloatingOrigin(camera, viewport));
}

/** Map a cached worker bitmap into a new camera without re-rendering it. */
export function workerBitmapDelta(
  previous: Camera,
  next: Camera,
  viewport: Viewport,
  dpr: number,
): Affine | null {
  const previousInverse = tryInvertAffine(buildWorldToScreenAffine(previous, viewport));
  if (!previousInverse) return null;
  const cssDelta = multiplyAffine(buildWorldToScreenAffine(next, viewport), previousInverse);
  return [cssDelta[0], cssDelta[1], cssDelta[2], cssDelta[3], cssDelta[4] * dpr, cssDelta[5] * dpr];
}

/**
 * The worker-bitmap delta that may actually be used, or `null` when the bitmap
 * must not stand in for the current frame.
 *
 * Only a *camera* change qualifies. The bitmap carries the `docVersion` it was
 * rendered for; when that differs from the current one the bitmap predates an
 * edit, and reprojecting it paints the pre-edit content over the edit. The
 * caller cannot decide this from the delta alone: `workerBitmapDelta` returns an
 * affine whenever the two camera transforms differ, *including the identity*
 * when they do not, so an unchanged camera yields a truthy "movement". A brush
 * stroke changes the document and leaves the camera alone, which is exactly the
 * case that was skipping the fresh replay and leaving new ink invisible.
 *
 * Returns the delta rather than a boolean so the caller narrows to a non-null
 * affine without a cast.
 */
export function reprojectableWorkerDelta(
  docIsCurrent: boolean,
  delta: Affine | null,
): Affine | null {
  return docIsCurrent ? delta : null;
}
