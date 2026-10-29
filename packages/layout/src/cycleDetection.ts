/**
 * Cycle detection for auto-layout parent-child resize relationships.
 *
 * Detects same-axis Fill/Hug dependencies between a visible flow child and its
 * immediate auto-layout frame. Layout breaks this loop deterministically by
 * using the child's minimum contribution while measuring the Hug parent.
 *
 * Research basis: CSS containment/layout cycle detection (CSS Sizing Level 4),
 * Figma auto-layout cycle guards, token alias cycle detection in color engines.
 */

import type { Document, NodeId } from '@varve/scene';
import { getParent } from '@varve/scene';
import { axisSizing, isFlowParticipant } from './measure';

export type LayoutCycleVerdict = 'no_cycle' | 'cycle_detected';

export interface CycleCheckResult {
  verdict: LayoutCycleVerdict;
  cycle: NodeId[];
  axis?: 'width' | 'height';
  /** Human-readable description of the cycle for debugging / user feedback. */
  description: string;
}

/**
 * Check whether applying a layout sizing change to `targetId` would create a
 * circular resize dependency in the document.
 *
 * A cycle exists when the target fills an axis that its immediate auto-layout
 * frame hugs. Independent axes are checked separately; hidden and absolute
 * children are excluded because they do not contribute to the parent's Hug
 * measurement.
 */
export function checkLayoutCycle(doc: Document, targetId: NodeId): CycleCheckResult {
  const target = doc.nodes[targetId];
  if (!target) {
    return { verdict: 'no_cycle', cycle: [], description: 'Target node not found' };
  }

  // Only visible flow children can contribute to their parent's Hug size.
  if (!isFlowParticipant(target)) {
    return { verdict: 'no_cycle', cycle: [], description: 'Not a flow participant' };
  }

  const parentId = getParent(doc, targetId);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  if (parent?.kind !== 'frame' || !parent.layoutStyle) {
    return { verdict: 'no_cycle', cycle: [], description: 'No layout cycle detected' };
  }

  for (const axis of ['width', 'height'] as const) {
    if (axisSizing(target, axis) !== 'fill' || axisSizing(parent, axis) !== 'hug') continue;
    return {
      verdict: 'cycle_detected',
      cycle: [targetId, parent.id],
      axis,
      description:
        `"${target.name ?? targetId}" fills ${axis} inside ` +
        `"${parent.name ?? parent.id}", which hugs its children on that axis. ` +
        `The layout resolves from the child's minimum contribution to avoid a sizing loop.`,
    };
  }
  return { verdict: 'no_cycle', cycle: [], description: 'No layout cycle detected' };
}
