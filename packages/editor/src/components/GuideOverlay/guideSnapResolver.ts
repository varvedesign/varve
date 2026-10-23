import { isMac } from '@varve/platform';
import type { Document, NodeId } from '@varve/scene';
import { loadSettings } from '../../settings';
import { type GuideSnapTarget, getGuideSnapTargets, snapGuidePosition } from './guideSnapTargets';

/** Maps a raw guide position onto the position the guide should take. */
export type GuideSnapResolver = (
  position: number,
  options?: { bypass?: boolean },
) => { position: number; snapped: boolean };

/**
 * Ctrl on Linux/Windows, Cmd on macOS, without Shift — the same rule object
 * drags use (`InteractionContext`), so a guide drag and an object drag bypass
 * snapping with the same gesture. Shift is reserved for constrained movement.
 */
export function isGuideSnapBypass(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  const commandKey = isMac() ? event.metaKey : event.ctrlKey;
  return commandKey && !event.shiftKey;
}

export interface CreateGuideSnapResolverOptions {
  doc: Document;
  axis: GuideSnapTarget['axis'];
  zoom: number;
  /** Editor snapping master switch (`EditorState.snapEnabled`). */
  snapEnabled: boolean;
  /** Active editing surface, so master-edit/isolation do not leak targets. */
  authoredNodeIds?: ReadonlySet<NodeId>;
}

/**
 * Resolve guide positions for one gesture.
 *
 * Preferences and candidates are read once, when the gesture starts: this
 * function parses the settings store and walks the active page, so it must not
 * be called per pointer sample. Returns `null` when snapping is off, so the
 * caller keeps its plain whole-pixel placement.
 */
export function createGuideSnapResolver(
  options: CreateGuideSnapResolverOptions,
): GuideSnapResolver | null {
  const { doc, axis, zoom, snapEnabled, authoredNodeIds } = options;
  if (!snapEnabled) return null;
  const { snapToObjects, snapTolerancePx } = loadSettings().viewport;
  if (!snapToObjects) return null;
  const targets = getGuideSnapTargets(doc, authoredNodeIds ? { authoredNodeIds } : {});
  if (targets.length === 0) return null;

  return (position: number, resolverOptions?: { bypass?: boolean }) => {
    if (!resolverOptions?.bypass) {
      const hit = snapGuidePosition(position, axis, targets, zoom, snapTolerancePx);
      if (hit) return { position: hit.position, snapped: true };
    }
    // Free dragging (or a bypassed sample) keeps the established whole-pixel
    // guide step.
    return { position: Math.round(position), snapped: false };
  };
}
