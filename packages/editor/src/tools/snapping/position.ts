import { boxSourceFeatures, findIsometricSnap, type IsometricSnapLock } from '../isometricSnapping';
import { createSnapCandidateState, SNAP_PRIORITY } from './candidates';
import { applyGridCandidate, applyLayoutGridStepCandidate, applyPixelGridCandidate } from './grid';
import {
  applyLayoutGridLineCandidates,
  applyRulerGuideCandidates,
  closestSegmentSnapCandidate,
} from './guides';
import {
  applyMidpointCandidates,
  applyObjectEdgeCandidates,
  applySpacingCandidates,
} from './objects';
import { resolveAxisSticky } from './stickyLock';
import { normalizeSnapTargets, releaseThresholdWorld, thresholdWorld } from './targets';
import type {
  GridSnapConfig,
  SnapGuide,
  SnapOptions,
  SnapResult,
  SnapSession,
  SnapTargetInput,
} from './types';

export function snapPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: SnapTargetInput[],
  grid?: number | GridSnapConfig,
  snapExcludedIds?: Set<string>,
  options: SnapOptions = {},
): SnapResult & { session: SnapSession; isometricLock?: IsometricSnapLock | null } {
  const zoom = options.zoom ?? 1;
  const sticky = options.sticky !== false;
  const thresh = thresholdWorld(zoom, options.tolerancePx);
  const release = releaseThresholdWorld(zoom, options.tolerancePx);
  let session: SnapSession = options.session ?? { stickyX: null, stickyY: null };

  // `x`/`y` are historically the current proposal. Callers that retain a
  // corrected box during a gesture can provide the raw proposal explicitly;
  // every candidate and hysteresis decision below then uses that intent. This
  // prevents a released lock from being re-acquired from its own correction.
  x = Number.isFinite(options.rawIntent?.x) ? options.rawIntent!.x : x;
  y = Number.isFinite(options.rawIntent?.y) ? options.rawIntent!.y : y;

  const normalizedTargets = normalizeSnapTargets(otherBounds);

  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

  const activeTargets =
    snapExcludedIds && snapExcludedIds.size > 0
      ? normalizedTargets.filter(
          (target) =>
            !snapExcludedIds.has(target.id) && !snapExcludedIds.has(String(target.originalIndex)),
        )
      : normalizedTargets;
  const activeBounds = activeTargets.map((target) => target.bounds);

  const state = createSnapCandidateState(x, y, w, h, thresh);

  // C1: Grid snap (highest priority)
  if (grid !== undefined && grid !== null) applyGridCandidate(state, grid);

  // C2: Layout grid snap
  if (options.layoutGridStep && options.layoutGridStep > 0) {
    applyLayoutGridStepCandidate(state, options.layoutGridStep);
  }

  // Authored frame layout guides are line targets, not an auto-layout cell
  // step. Their lower priority preserves document-grid, ruler-guide, and
  // object-edge snaps when several candidates are close together.
  if (options.layoutGridTargets && options.layoutGridTargets.length > 0) {
    applyLayoutGridLineCandidates(state, options.layoutGridTargets);
  }

  // Transformed frame/page layouts are finite segments rather than infinite
  // axis lines. Choose one projection and apply its complete 2-D correction so
  // rotated, mirrored, scaled, and nested owners never shear the selection.
  let bestJointLayout: {
    dx: number;
    dy: number;
    distance: number;
    guide: SnapGuide;
  } | null = null;
  if (options.layoutGuideSegments && options.layoutGuideSegments.length > 0) {
    for (const target of options.layoutGuideSegments) {
      const candidate = closestSegmentSnapCandidate(x, y, w, h, target, thresh);
      if (!candidate) continue;
      if (!bestJointLayout || candidate.distance < bestJointLayout.distance) {
        bestJointLayout = candidate;
      }
    }
  }

  // C3: Pixel grid snap (snaps to integer pixel coordinates)
  if (options.pixelGridSnap) applyPixelGridCandidate(state);

  // C2.5: Permanent ruler guides. These are line targets, so compare every
  // movable edge/center on the matching axis against the guide's position.
  if (options.guideTargets && options.guideTargets.length > 0) {
    applyRulerGuideCandidates(state, options.guideTargets);
  }

  // C3: Mid-point between two objects. The canonical evaluation scans every
  // unordered pair (O(k²)); the criterion is symmetric, so the winning pair
  // is found by sorting centers once and, per node, binary-searching the
  // partner whose center is closest to (2*cx - center) — O(k log k) with
  // identical winners (verified against the pair scan by the parity tests in
  // tools/__benchmarks__/snapParity.bench.test.ts).
  if (activeBounds.length > 1) applyMidpointCandidates(state, activeBounds, activeTargets);

  applyObjectEdgeCandidates(state, activeTargets);

  // C3: Isometric lattice snap (joint 2-D candidate).
  //
  // An oblique lattice cannot be snapped by correcting X and Y independently:
  // the nearest intersection is a property of the pair. The solver returns a
  // single translation for the whole selection; it competes with the winning
  // axis candidates by distance (see SnapOptions.isometric).
  let isoGuide: SnapGuide | null = null;
  let isoLock: IsometricSnapLock | null = null;
  if (options.isometric) {
    const features =
      options.snapFeatures && options.snapFeatures.length > 0
        ? options.snapFeatures
        : boxSourceFeatures({ x, y, w, h });
    const iso = findIsometricSnap(features, options.isometric);
    if (iso) {
      const hasAxisCandidate = Number.isFinite(state.bestXDiff) || Number.isFinite(state.bestYDiff);
      const competing = Math.hypot(
        Number.isFinite(state.bestXDiff) ? state.bestXDiff : 0,
        Number.isFinite(state.bestYDiff) ? state.bestYDiff : 0,
      );
      if (!hasAxisCandidate || iso.distance <= competing + 1e-9) {
        snappedX = x + iso.translation.x;
        snappedY = y + iso.translation.y;
        // Isometric locks are 2-D and own both axes for this sample; clear any
        // axis lock so its correction is never re-applied on top.
        session = { stickyX: null, stickyY: null };
        state.bestXGuide = null;
        state.bestYGuide = null;
        state.bestXDiff = Infinity;
        state.bestYDiff = Infinity;
        isoGuide = {
          axis: 'vertical',
          position: snappedX,
          label: iso.kind === 'intersection' ? 'iso' : 'iso line',
          type: 'edge',
          targetId: `isometric:${options.isometric.id}`,
          sourceFeature: 'corner',
          targetFeature: iso.kind,
          referenceSpace: 'world',
          correction: iso.translation.x,
          point: { x: iso.snappedPoint[0], y: iso.snappedPoint[1] },
        };
        isoLock = iso.lock;
      }
    }
  }

  const resolvedX = resolveAxisSticky(
    'vertical',
    x,
    state.bestXSnap,
    state.bestXGuide,
    session.stickyX,
    release,
    sticky,
    activeTargets,
  );
  if (resolvedX.applied) {
    snappedX = resolvedX.coord;
    session = { ...session, stickyX: resolvedX.lock };
  }
  if (resolvedX.pushGuide) guides.push(state.bestXGuide!);

  const resolvedY = resolveAxisSticky(
    'horizontal',
    y,
    state.bestYSnap,
    state.bestYGuide,
    session.stickyY,
    release,
    sticky,
    activeTargets,
  );
  if (resolvedY.applied) {
    snappedY = resolvedY.coord;
    session = { ...session, stickyY: resolvedY.lock };
  }
  if (resolvedY.pushGuide) guides.push(state.bestYGuide!);

  // The isometric guide is pushed after the axis machinery so an axis lock
  // (now cleared) can never add a conflicting line for the same sample.
  if (isoGuide) guides.push(isoGuide);

  // C4: Spacing distribution (lowest priority). The canonical evaluation is
  // O(k²) over every ordered pair (a,b) with a.right < cx < b.left. Because
  // |gap - (mid - cx)| equals |b.left - 3*a.right + 2*cx| / 2, the best b for
  // a fixed a is the left edge closest to (3*a.right - 2*cx) among left edges
  // > cx — a sorted binary search, reducing the rule to O(k log k) with
  // identical winners (parity-verified).
  if (activeTargets.length > 1) applySpacingCandidates(state, activeTargets);

  // Spacing is selected after the cheaper edge/midpoint rules, so apply its
  // winning candidate through the same sticky resolver as every other snap.
  // This keeps the session and the visible guide in agreement instead of
  // returning a corrected coordinate with the previous lock still active.
  if (state.bestXGuide?.type === 'spacing') {
    const spacingX = resolveAxisSticky(
      'vertical',
      x,
      state.bestXSnap,
      state.bestXGuide,
      session.stickyX,
      release,
      sticky,
      activeTargets,
    );
    snappedX = spacingX.coord;
    session = { ...session, stickyX: spacingX.lock };
    if (spacingX.pushGuide) guides.push(state.bestXGuide);
  }
  if (state.bestYGuide?.type === 'spacing') {
    const spacingY = resolveAxisSticky(
      'horizontal',
      y,
      state.bestYSnap,
      state.bestYGuide,
      session.stickyY,
      release,
      sticky,
      activeTargets,
    );
    snappedY = spacingY.coord;
    session = { ...session, stickyY: spacingY.lock };
    if (spacingY.pushGuide) guides.push(state.bestYGuide);
  }

  if (
    bestJointLayout &&
    bestJointLayout.distance < thresh &&
    (bestJointLayout.guide.type === 'layout-grid' ||
      bestJointLayout.guide.type === 'page-layout') &&
    bestJointLayout.distance <=
      (Number.isFinite(state.bestXDiff) || Number.isFinite(state.bestYDiff)
        ? Math.hypot(
            Number.isFinite(state.bestXDiff) ? state.bestXDiff : 0,
            Number.isFinite(state.bestYDiff) ? state.bestYDiff : 0,
          )
        : Infinity) +
        1e-9 &&
    state.bestXPriority < SNAP_PRIORITY.guide &&
    state.bestYPriority < SNAP_PRIORITY.guide
  ) {
    snappedX = x + bestJointLayout.dx;
    snappedY = y + bestJointLayout.dy;
    guides.length = 0;
    guides.push(bestJointLayout.guide);
    session = { stickyX: null, stickyY: null };
  }

  const matches = guides.flatMap((guide) => {
    if (!guide.targetId || !guide.sourceFeature || !guide.targetFeature) return [];
    const pointCorrection = guide.point ? { x: snappedX - x, y: snappedY - y } : null;
    return [
      {
        targetId: guide.targetId,
        sourceFeature: guide.sourceFeature,
        targetFeature: guide.targetFeature,
        referenceSpace: 'world' as const,
        correction: pointCorrection ?? {
          x: guide.axis === 'vertical' ? (guide.correction ?? snappedX - x) : 0,
          y: guide.axis === 'horizontal' ? (guide.correction ?? snappedY - y) : 0,
        },
        category: guide.type ?? 'edge',
      },
    ];
  });
  return {
    x: snappedX,
    y: snappedY,
    guides,
    matches: matches.length > 0 ? matches : undefined,
    session,
    isometricLock: isoLock,
  };
}
