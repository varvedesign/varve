import type { NormalizedSnapTarget, SnapGuide, SnapLock, SnapSession } from './types';

function snapLockForGuide(guide: SnapGuide, snappedCoord: number): SnapLock {
  return {
    guidePosition: guide.position,
    snappedCoord,
    targetId: guide.targetId,
    sourceFeature: guide.sourceFeature,
    targetFeature: guide.targetFeature,
    type: guide.type,
    referenceSpace: guide.referenceSpace,
  };
}

function lockMatchesGuide(lock: SnapLock, guide: SnapGuide): boolean {
  if (lock.targetId !== undefined || guide.targetId !== undefined) {
    return (
      lock.targetId === guide.targetId &&
      lock.sourceFeature === guide.sourceFeature &&
      lock.targetFeature === guide.targetFeature &&
      lock.guidePosition === guide.position &&
      lock.referenceSpace === guide.referenceSpace
    );
  }
  return (
    lock.guidePosition === guide.position &&
    lock.sourceFeature === guide.sourceFeature &&
    lock.targetFeature === guide.targetFeature &&
    lock.type === guide.type
  );
}

function guideFromLock(axis: 'horizontal' | 'vertical', lock: SnapLock): SnapGuide {
  return {
    axis,
    position: lock.guidePosition,
    targetId: lock.targetId,
    sourceFeature: lock.sourceFeature,
    targetFeature: lock.targetFeature,
    type: lock.type,
    referenceSpace: lock.referenceSpace,
  };
}

function stickyTargetIsInScope(lock: SnapLock, activeTargets: NormalizedSnapTarget[]): boolean {
  const targetId = lock.targetId;
  if (!targetId) return true;
  if (
    targetId.startsWith('grid:') ||
    targetId.startsWith('layout-grid:') ||
    targetId.startsWith('pixel-grid:') ||
    targetId.startsWith('guide:')
  ) {
    return true;
  }
  if (targetId.startsWith('midpoint:')) {
    const ids = targetId.slice('midpoint:'.length).split(':');
    return ids.every((id) => activeTargets.some((target) => target.id === id));
  }
  return activeTargets.some((target) => target.id === targetId);
}

function tryStickyAxis(
  rawIntentCoord: number,
  proposedCoord: number,
  guide: SnapGuide,
  session: SnapSession['stickyX'],
  release: number,
  sticky: boolean,
): { coord: number; session: SnapSession['stickyX']; snapped: boolean } {
  if (sticky && session && lockMatchesGuide(session, guide)) {
    if (Math.abs(rawIntentCoord - session.snappedCoord) < release) {
      return { coord: session.snappedCoord, session, snapped: true };
    }
    return { coord: rawIntentCoord, session: null, snapped: false };
  }
  const lock = snapLockForGuide(guide, proposedCoord);
  return {
    coord: proposedCoord,
    session: lock,
    snapped: true,
  };
}

/**
 * Resolve one axis through the sticky session. This is a 1:1 mapping of the
 * original inline branches: a winning guide competes with an existing lock, an
 * existing lock can hold without a fresh guide, and an out-of-scope lock is
 * released.
 */
export function resolveAxisSticky(
  axis: 'horizontal' | 'vertical',
  rawCoord: number,
  proposedCoord: number,
  guide: SnapGuide | null,
  lock: SnapLock | null,
  release: number,
  sticky: boolean,
  activeTargets: NormalizedSnapTarget[],
): { coord: number; lock: SnapLock | null; pushGuide: boolean; applied: boolean } {
  if (guide) {
    const stickyResult = tryStickyAxis(rawCoord, proposedCoord, guide, lock, release, sticky);
    return {
      coord: stickyResult.coord,
      lock: sticky && stickyResult.snapped ? stickyResult.session : null,
      pushGuide: stickyResult.snapped || !sticky,
      applied: true,
    };
  }
  if (sticky && lock && stickyTargetIsInScope(lock, activeTargets)) {
    const lockGuide = guideFromLock(axis, lock);
    const hold = tryStickyAxis(rawCoord, rawCoord, lockGuide, lock, release, true);
    if (hold.snapped) return { coord: hold.coord, lock, pushGuide: false, applied: true };
    return { coord: rawCoord, lock: null, pushGuide: false, applied: true };
  }
  if (sticky && lock) return { coord: rawCoord, lock: null, pushGuide: false, applied: true };
  return { coord: rawCoord, lock, pushGuide: false, applied: false };
}

/** Create a fresh snap session (call on pointer down). */
export function createSnapSession(): SnapSession {
  return { stickyX: null, stickyY: null };
}
