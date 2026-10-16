/**
 * Dock layout model (ADR-0021).
 *
 * A normalized tree of split/tabs/panel/canvas/empty nodes per application
 * window, plus the window set of a workspace layout. The canvas is a
 * protected central anchor in the primary window. Pure data — no React, no
 * platform APIs. All mutations go through dockOps.ts so the model stays
 * testable without a DOM.
 *
 * Identity rules (ADR-0020): every node and instance carries a stable
 * uuid; titles and array indexes are never used as identity.
 */

import type { PanelTypeId } from '../panelIds';

export type { PanelTypeId };

export type DockNodeId = string;
export type PanelInstanceId = string;
export type WorkspaceWindowId = string;
export type WorkspaceWindowRole = 'primary' | 'auxiliary-panel';

/** Dock's reference to a concrete panel instance hosted in a window. */
export interface PanelInstanceRef {
  instanceId: PanelInstanceId;
  panelTypeId: PanelTypeId;
  /** Set only when a panel is pinned to a document (deferred, ADR-0027). */
  documentId?: string;
  titleOverride?: string;
}

/**
 * Portable fractional placement for an in-window floating group. Values are
 * fractions of the primary editor content bounds, never CSS pixels or screen
 * coordinates, so the same layout scales safely on another display.
 */
export interface NormalizedFloatBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Panels sharing one movable, resizable floating surface in the main window. */
export interface DockFloatingGroup {
  id: DockNodeId;
  panels: PanelInstanceRef[];
  activePanelInstanceId?: PanelInstanceId;
  normalizedBounds: NormalizedFloatBounds;
}

export type DockSplitDirection = 'row' | 'column';

/**
 * Height of the chrome a docked panel draws above its own content (the panel
 * strip with its title and move control). Panel minimum/preferred/maximum
 * heights are contracts about the *body*, so anything resolving a panel's box
 * on the block axis must add this — the same way `getDockNodeMinimumSize` and
 * `getDockNodeMaximumSize` do.
 *
 * These live here (a data module with no imports) rather than in `dockOps`
 * because `dockPanelSizing` needs them too, and `dockOps` already imports
 * `dockPanelSizing`. `dockOps` re-exports both for its existing importers.
 */
export const DOCK_PANEL_CHROME_HEIGHT = 32;

/** Extra strip a tab group draws above the active panel's body. */
export const DOCK_TAB_STRIP_MIN_HEIGHT = 32;

export type DockNode =
  | {
      kind: 'split';
      id: DockNodeId;
      direction: DockSplitDirection;
      /** First pane share, in (0, 1); second pane takes 1 - ratio. */
      ratio: number;
      /**
       * Set once the user has resized this split.
       *
       * A built-in split that nobody has touched opens at the pane's declared
       * `preferredSize` instead of its ratio (`dockPanelSizing.ts`). That must
       * be real state, not a guess: a nudge that lands exactly on the creation
       * ratio — the default window's first `ArrowRight` does — would otherwise
       * look "untouched" and the keypress would be silently swallowed.
       */
      ratioTouched?: boolean;
      first: DockNode;
      second: DockNode;
    }
  | {
      kind: 'tabs';
      id: DockNodeId;
      activePanelInstanceId?: PanelInstanceId;
      panels: PanelInstanceRef[];
    }
  | {
      kind: 'panel';
      id: DockNodeId;
      panelInstanceId: PanelInstanceId;
      /** Self-describing: required so serialized trees are validatable. */
      panelTypeId: PanelTypeId;
    }
  | {
      /** Protected anchor for the one shared editor canvas in the primary window. */
      kind: 'canvas';
      id: DockNodeId;
    }
  | { kind: 'empty'; id: DockNodeId };

export interface WorkspaceWindowLayout {
  id: WorkspaceWindowId;
  role: WorkspaceWindowRole;
  dockRoot: DockNode;
  /** In-window floats are portable layout intent; machine pixel placement is never stored here. */
  floatingGroups?: DockFloatingGroup[];
}

/** A complete (portable) workspace layout: the window set. */
export interface DockLayout {
  schemaVersion: number;
  windows: WorkspaceWindowLayout[];
}

export const DOCK_LAYOUT_SCHEMA_VERSION = 3;

export function createCanvasNode(id = 'canvas-primary'): DockNode {
  return { kind: 'canvas', id };
}

export function createPanelInstanceRef(panelTypeId: PanelTypeId): PanelInstanceRef {
  return { instanceId: newId(), panelTypeId };
}

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Deterministic fallback for environments without crypto (tests, old
  // WebKitGTK baselines). Collision-resistant enough for session identity.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
