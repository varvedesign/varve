// COMPLEXITY: 10 — thin re-exports from boolean/ module.
// This file preserves backward compatibility for all existing callers.

export {
  cleanupPolygon as cleanPolygon,
  hasSelfIntersections,
  resolveSelfIntersections,
} from './boolean/polygon-clipper';

export { pointInRegion as pointInPolygon } from './boolean/region';
export type { Point2D } from './boolean/region';
export { segmentIntersectionRobust as segmentIntersection } from './boolean/precision';
export { shapeToPolygon } from './boolean/integration';

export type { BooleanOpType as BooleanOpKind } from './boolean/engine';
export {
  booleanOp,
  shapeNodesInWorldSpace,
  booleanAnchorForNode,
  placeBooleanResult,
} from './boolean/integration';
