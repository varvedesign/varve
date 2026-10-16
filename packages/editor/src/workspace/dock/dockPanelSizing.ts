/**
 * Panel sizing policy for the desktop dock.
 *
 * The dock's tree stores *ratios*, so a pane's resolved size grows with the
 * window. That is the right model for a size the user dragged (they asked for
 * a share of the window) but the wrong one for the size a panel *opens* at:
 * a 2560px window used to paint a 563px Layers rail, against a registry that
 * declares 288px, while the canvas lost the difference.
 *
 * This module is the single place that turns the registry's declared size
 * contract into geometry input, so the compact grid path
 * (`PanelResizeHandle`/`PANEL_LIMITS`) and the desktop dock cannot disagree
 * about what a panel's usable range is.
 *
 * Rules:
 * - **Opening size.** For the built-in splits, the pane's size is
 *   `min(ratio-derived size, preferredSize)`. On a narrow host the ratio is
 *   smaller and still wins (no panel is grown at the canvas's expense); on a
 *   roomy host the ratio would exceed the declared contract, and the surplus
 *   goes to the canvas instead.
 * - **Explicit resize.** Once the user moves a splitter the stored ratio is no
 *   longer the built-in default, the preferred ceiling stops applying, and the
 *   pane may grow to `maximumSize`.
 */

import { tryGetPanelDefinition } from '../panelRegistry';
import { panelWidthLimits } from '../panelWidthLimits';
import {
  DOCK_PANEL_CHROME_HEIGHT,
  DOCK_TAB_STRIP_MIN_HEIGHT,
  type DockNode,
  type DockSplitDirection,
  type PanelTypeId,
} from './dockTypes';

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * Built-in splits whose opening allocation is governed by a declared
 * preferred size rather than by their stored ratio alone. `side` names the
 * pane that owns the contract; the other pane (the canvas subtree) absorbs
 * whatever is left. `defaultRatio` identifies the split as still untouched —
 * `setSplitRatio` replaces the ratio the moment a user resizes it.
 */
export const BUILTIN_SPLIT_PREFERRED: Readonly<
  Record<string, { side: 'first' | 'second'; direction: DockSplitDirection; defaultRatio: number }>
> = {
  'layers-main': { side: 'first', direction: 'row', defaultRatio: 0.22 },
  'center-inspector': { side: 'second', direction: 'row', defaultRatio: 0.69 },
  'center-column': { side: 'second', direction: 'column', defaultRatio: 0.72 },
};

/** True when a built-in split still carries the ratio it was created with. */
export function isUntouchedBuiltinSplit(node: DockNode): boolean {
  if (node.kind !== 'split') return false;
  if (node.ratioTouched === true) return false;
  return BUILTIN_SPLIT_PREFERRED[node.id] !== undefined;
}

/**
 * Ratio a built-in split was created with, for the splitter's reset gesture.
 * `null` for any split the user created, where "default" has no meaning.
 */
export function getBuiltinDefaultRatio(nodeId: string): number | null {
  return BUILTIN_SPLIT_PREFERRED[nodeId]?.defaultRatio ?? null;
}

/**
 * The pane governed by the declared contract for an untouched built-in split
 * in the given axis, plus the preferred extent that pane should keep.
 * Returns `null` when the split has no declared contract (user-created
 * splits, custom ratios, or a non-panel pane).
 */
export function getBuiltinPreferredExtent(
  node: DockNode,
  direction: DockSplitDirection,
  first: DockNode,
  second: DockNode,
): { side: 'first' | 'second'; extent: number } | null {
  if (node.kind !== 'split') return null;
  const builtin = BUILTIN_SPLIT_PREFERRED[node.id];
  if (!builtin) return null;
  if (builtin.direction !== direction) return null;
  if (!isUntouchedBuiltinSplit(node)) return null;
  const governed = builtin.side === 'first' ? first : second;
  const preferred = getDockNodePreferredSize(governed);
  if (!preferred) return null;
  const extent = direction === 'row' ? preferred.width : preferred.height;
  return extent > 0 ? { side: builtin.side, extent } : null;
}

/**
 * Preferred size of a pane that holds panels. Tabs must satisfy every panel
 * it hosts, so the tightest preferred size wins — the same relationship the
 * minimum-size rule uses. Heights are about the panel *body*, so the pane's one
 * block of chrome is added exactly as `getDockNodeMinimumSize` and
 * `getDockNodeMaximumSize` add it: a tab group draws a tab strip *instead of*
 * the single-panel chrome row, never both (`useEditorDockGeometry.ts` offsets
 * every pane body by one `DOCK_PANEL_CHROME_HEIGHT`). A `tabs` node with one
 * panel cannot reach here — `projectVisibleDockTree` collapses it to a panel.
 */
export function getDockNodePreferredSize(node: DockNode): PanelSize | null {
  switch (node.kind) {
    case 'panel': {
      const preferred = panelPreferredSize(node.panelTypeId);
      return preferred
        ? { width: preferred.width, height: preferred.height + DOCK_PANEL_CHROME_HEIGHT }
        : null;
    }
    case 'tabs': {
      let resolved: PanelSize | null = null;
      for (const panel of node.panels) {
        const preferred = panelPreferredSize(panel.panelTypeId);
        if (!preferred) continue;
        resolved = resolved
          ? {
              width: Math.min(resolved.width, preferred.width),
              height: Math.min(resolved.height, preferred.height),
            }
          : preferred;
      }
      if (!resolved) return null;
      // One row, not two: the strip replaces the panel chrome for a group.
      const chrome = node.panels.length > 1 ? DOCK_TAB_STRIP_MIN_HEIGHT : DOCK_PANEL_CHROME_HEIGHT;
      return { width: resolved.width, height: resolved.height + chrome };
    }
    default:
      return null;
  }
}

/**
 * Largest size the user may drag a pane to. `preferredSize` does not bound a
 * drag — a user may legitimately want a wider rail than it opens at — so the
 * bound is the declared `maximumSize`, or twice the preferred size when a
 * definition does not declare one (which is the built-in policy: layers 576,
 * inspector 640, the "wide" rail five inspector specs already exercise).
 */
export function getDockPanelMaximumSize(panelTypeId: PanelTypeId): PanelSize | null {
  const definition = tryGetPanelDefinition(panelTypeId);
  if (!definition) return null;
  // Width comes from the shared reader so the dock and the compact tier cannot
  // drift; the block axis is dock-only (chrome is added by the node helpers).
  const limits = panelWidthLimits(panelTypeId);
  const width = limits?.max ?? definition.minimumSize.width * 2;
  if (definition.maximumSize) return { width, height: definition.maximumSize.height };
  if (definition.preferredSize) {
    return { width, height: definition.preferredSize.height * 2 };
  }
  return { width, height: definition.minimumSize.height * 2 };
}

function panelPreferredSize(panelTypeId: PanelTypeId): PanelSize | null {
  const preferred = tryGetPanelDefinition(panelTypeId)?.preferredSize;
  return preferred ? { ...preferred } : null;
}

/**
 * Title of the pane a dock subtree presents, used to give each splitter a
 * distinct accessible name. Tabs answer with their active panel; a split
 * answers with the first pane that has a title (the other side of a built-in
 * split is the canvas, which has none).
 */
export function getDockNodePaneTitle(node: DockNode): string | null {
  switch (node.kind) {
    case 'panel':
      return tryGetPanelDefinition(node.panelTypeId)?.title ?? null;
    case 'tabs': {
      const active =
        node.panels.find((panel) => panel.instanceId === node.activePanelInstanceId) ??
        node.panels[0];
      return active ? (tryGetPanelDefinition(active.panelTypeId)?.title ?? null) : null;
    }
    case 'split':
      return getDockNodePaneTitle(node.first) ?? getDockNodePaneTitle(node.second);
    default:
      return null;
  }
}

/**
 * Accessible name for the splitter of a split: the pane a user perceives
 * themselves resizing. Naming every splitter "Resize dock panels" announced
 * two or three identical controls with no way to tell which one had focus; the
 * ARIA window-splitter pattern instead names the splitter after the pane it
 * sizes. When the first pane is the canvas subtree, the titled pane on the
 * other side is the one the seam belongs to (the Inspector's edge, not the
 * artboard's).
 */
export function getDockSplitAccessibleName(first: DockNode, second: DockNode): string {
  const title = getDockNodePaneTitle(first) ?? getDockNodePaneTitle(second);
  return title ? `Resize ${title} panel` : 'Resize dock panels';
}

/**
 * Panel types whose container carries a stable element id
 * (`id="editor-<type>-panel"` in `Shell.tsx`). Used for `aria-controls`, which
 * must reference an element that exists: the bottom-strip panels
 * (timeline/email) are rendered by `WorkspaceBottomPanels` and have no such id,
 * so they deliberately omit the attribute instead of pointing nowhere.
 */
const PANELS_WITH_ELEMENT_ID: ReadonlySet<PanelTypeId> = new Set([
  'layers',
  'inspector',
  'pagenav',
  'library',
  'codegen',
  'logo',
  'history',
]);

/**
 * The element a splitter's `aria-controls` may point at: the container of the
 * pane it sizes, when that pane is a single panel with a known id.
 */
export function getDockSplitControlledId(first: DockNode, second: DockNode): string | null {
  const pane = hasElementId(first) ? first : hasElementId(second) ? second : null;
  if (pane?.kind === 'panel' && PANELS_WITH_ELEMENT_ID.has(pane.panelTypeId)) {
    return `editor-${pane.panelTypeId}-panel`;
  }
  return null;
}

function hasElementId(node: DockNode): boolean {
  if (node.kind === 'panel') return PANELS_WITH_ELEMENT_ID.has(node.panelTypeId);
  if (node.kind === 'tabs') {
    const active =
      node.panels.find((panel) => panel.instanceId === node.activePanelInstanceId) ??
      node.panels[0];
    return active ? PANELS_WITH_ELEMENT_ID.has(active.panelTypeId) : false;
  }
  if (node.kind === 'split') return hasElementId(node.first) || hasElementId(node.second);
  return false;
}
