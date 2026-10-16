/**
 * Registry-derived panel width ranges.
 *
 * A panel's usable width range is declared once, in `panelDefinitions.ts`
 * (`minimumSize`, and `maximumSize` or twice `preferredSize`), and read from
 * here by every surface that lets a user resize or announces a range:
 *
 * - `components/PanelResizeHandle.tsx` (Layers/Inspector, the compact tier)
 * - `components/ResourcesPanel/PanelWidthDragEdge.tsx` (Resources)
 * - `workspace/dock/dockPanelSizing.ts` (the desktop dock's pane maximum)
 *
 * The literal fallbacks live with each caller: they only cover the window
 * between module evaluation and `registerBuiltinPanels()`, and a caller
 * silently keeping its own numbers after registration is exactly the drift this
 * module exists to prevent (the Layers rail's range used to be written down in
 * two places that disagreed with the dock that actually sized it).
 */

import type { PanelTypeId } from './panelIds';
import { tryGetPanelDefinition } from './panelRegistry';

export interface PanelWidthLimits {
  min: number;
  max: number;
}

/**
 * `null` when the registry has not registered the panel (pre-boot).
 *
 * The maximum mirrors the dock's policy exactly — declared `maximumSize`, else
 * twice the preferred width, else twice the minimum — so the two tiers cannot
 * disagree even for a definition that declares neither.
 */
export function panelWidthLimits(panelTypeId: PanelTypeId): PanelWidthLimits | null {
  const definition = tryGetPanelDefinition(panelTypeId);
  if (!definition) return null;
  const min = definition.minimumSize.width;
  const declaredMax =
    definition.maximumSize?.width ??
    (definition.preferredSize ? definition.preferredSize.width * 2 : min * 2);
  return { min, max: Math.max(min, declaredMax) };
}
