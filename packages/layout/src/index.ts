/**
 * @varve/layout — the CSS-native layout IR: flex and grid auto-layout,
 * reflow, and the geometry utilities the layout engine shares with the
 * editor's transform pipeline.
 *
 * The designer's layout IS the handoff CSS. This package holds the pure,
 * DOM-free layout computations (mirroring the `varve-layout` Rust crate's
 * intended surface):
 *
 * - `computeFlexLayout` — row/column/reverse, wrap, gap, padding, align/
 *   justify, grow/shrink, fill/hug/fixed sizing (CSS flexbox model).
 * - `computeGridLayout` / `applyGridLayout` / `parseGridTracks` — explicit
 *   bounded px/fr/auto tracks, auto-placement, and placement overrides.
 * - `reflowLayoutChildren` — the single entry point that repositions (and,
 *   for fill/grow children, resizes) a frame's children against its current
 *   box after any frame-size change.
 * - `resizeNodeGeometry` — type-aware geometry resizing shared by the
 *   layout engine, inspector W/H edits, and transform baking.
 * - `checkLayoutCycle` — cycle guard for nested layout containers.
 *
 * Nothing here touches the DOM; the editor owns canvas adapters and the
 * rendering pipeline (see `packages/editor/src/layout/` for editor-only
 * arranging utilities such as autoArrange and table layout).
 */
export type { FlexLayoutDiagnostic, FlexLayoutResult, LayoutResult } from './computeFlexLayout';
export { computeFlexLayout, computeFlexLayoutDetailed } from './computeFlexLayout';
export type { GridItem, GridLayoutDiagnostic, GridLayoutResult } from './computeGridLayout';
export {
  applyGridLayout,
  computeGridLayout,
  computeGridLayoutDetailed,
  parseGridTrackDefinitions,
  parseGridTracks,
} from './computeGridLayout';
export type { CycleCheckResult, LayoutCycleVerdict } from './cycleDetection';
export { checkLayoutCycle } from './cycleDetection';
export type { GridTrackAxis, GridTrackRehome, GridTrackRemovalPreview } from './gridTrackMutations';
export {
  anchorGridPlacements,
  createGridTrack,
  ensureGridTrackIdentities,
  initializeGridTracks,
  previewRemoveGridTrack,
  reorderGridTrack,
  resizeGridTrack,
} from './gridTrackMutations';
export { resolveIntrinsicSizes } from './intrinsicSize';
export type { NodeFootprint, Size } from './measure';
export {
  axisSizing,
  clampAxis,
  isFlowParticipant,
  measureNodeFootprint,
  measureNodeSize,
} from './measure';
export { reflowLayoutChildren } from './reflow';
export { resizeNodeGeometry } from './resizeGeometry';
export const PACKAGE = '@varve/layout' as const;
