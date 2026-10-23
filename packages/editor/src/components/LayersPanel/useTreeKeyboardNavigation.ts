/**
 * useTreeKeyboardNavigation — extracts the keyboard handler for the APG
 * Tree View from LayersTree, keeping the main component below its
 * cyclomatic-complexity ceiling.
 *
 * Handles: Arrow keys, Home/End, Enter, Space, Ctrl+A, F2, Ctrl+[/],
 * Shift+F10/ContextMenu, Escape (isolation exit), and type-ahead.
 */

import type { Virtualizer } from '@tanstack/react-virtual';
import type { NodeId } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { useCallback } from 'react';
import type { SelectionOrigin } from '../../context/selectionState';
import type { FlatEntry } from './useFlatTree';

/**
 * True when the key event originated on a control that owns its own
 * activation semantics.
 *
 * Rows contain real buttons (disclosure, type icon, visibility, lock, solo,
 * details). The tree's Enter/Space handler used to run after those buttons had
 * already handled the same key, so pressing Enter on a lock toggle both
 * activated the button and re-activated the row's selection. Arrow keys still
 * navigate: the controls are outside the Tab order and are reached through
 * the row, not treated as independent tree stops.
 */
function isControlOwnedActivation(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'button, input, textarea, select, a[href], [role="button"], [role="checkbox"], [role="switch"], [contenteditable="true"]',
    ) !== null
  );
}

interface UseTreeKeyboardNavigationArgs {
  entries: FlatEntry[];
  focusIdx: number;
  expanded: Set<NodeId>;
  isolatedNodeId: NodeId | null;
  exitIsolation: () => void;
  doKeyboardMove: (delta: number) => void;
  toggleExpand: (id: NodeId) => void;
  toggleSelection: (id: NodeId, additive?: boolean, origin?: SelectionOrigin) => void;
  selectRange: (id: NodeId, additive: boolean) => void;
  activateSelection: (id: NodeId) => void;
  setFocusIdx: (idx: number) => void;
  jumpToStart: () => void;
  jumpToEnd: (length: number) => void;
  selectAll: () => void;
  handleTypeAhead: (
    key: string,
    getName: (i: number) => string,
    currentIdx: number,
    length: number,
  ) => number | null;
  startRename: (id: NodeId) => void;
  /** Canonical arrange transaction (identical to the global bracket keys). */
  arrangeSelection: (op: 'forward' | 'backward') => void;
  /** Move the focused selection into the container displayed above (indent). */
  indentSelection: () => void;
  /** Move the focused selection out of its container, below its block (outdent). */
  outdentSelection: () => void;
  /** APG optional `*`: expand all closed container siblings of the node. */
  expandSiblings: (id: NodeId) => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  onContextMenuKeyboard?: (id: NodeId, focusedRow?: HTMLElement) => void;
}

export function useTreeKeyboardNavigation({
  entries,
  focusIdx,
  expanded,
  isolatedNodeId,
  exitIsolation,
  doKeyboardMove,
  toggleExpand,
  toggleSelection,
  selectRange,
  activateSelection,
  setFocusIdx,
  jumpToStart,
  jumpToEnd,
  selectAll,
  handleTypeAhead,
  startRename,
  arrangeSelection,
  indentSelection,
  outdentSelection,
  expandSiblings,
  virtualizer,
  onContextMenuKeyboard,
}: UseTreeKeyboardNavigationArgs) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const focused = entries[focusIdx];
        if (focused) {
          // Resolve the row from the event's owner document. A detached
          // Layers window must not query the main application document, and
          // a virtualized row may not exist until the navigation hook has
          // revealed it.
          const active = e.currentTarget.ownerDocument.activeElement as HTMLElement | null;
          const focusedRow =
            active?.closest<HTMLElement>('[data-node-id]') ??
            (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]');
          onContextMenuKeyboard?.(focused.node.id, focusedRow ?? undefined);
        }
        return;
      }

      // Escape exits isolation/focus view regardless of filter state.
      if (e.key === 'Escape' && isolatedNodeId) {
        e.preventDefault();
        exitIsolation();
        return;
      }

      if (entries.length === 0) return;

      const focusedNode = entries[focusIdx]?.node;

      // Shift+Arrow: extend selection
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(focusIdx + delta, entries.length - 1));
        setFocusIdx(next);
        const nextEntry = entries[next];
        if (!nextEntry) throw new Error('next entry not found');
        selectRange(nextEntry.node.id, e.ctrlKey || e.metaKey);
        virtualizer.scrollToIndex(next, { align: 'auto' });
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        doKeyboardMove(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        doKeyboardMove(-1);
        return;
      }

      // Right arrow: expand or step into the first *displayed* child.
      //
      // Display order is front-most first, the reverse of `children` (raw
      // paint order), so `children[0]` is the last visible child. In a filtered
      // projection it may not be displayed at all. The row immediately after
      // the focused one is the first displayed child whenever this row is
      // open, which is both display-correct and filter-correct.
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const focusedEntry = entries[focusIdx];
        if (focusedNode && focusedEntry && isContainer(focusedNode)) {
          const childrenVisible = focusedEntry.childrenVisible ?? expanded.has(focusedNode.id);
          if (!childrenVisible) {
            toggleExpand(focusedNode.id);
            return;
          }
          const next = entries[focusIdx + 1];
          if (next && next.depth > focusedEntry.depth) {
            setFocusIdx(focusIdx + 1);
            virtualizer.scrollToIndex(focusIdx + 1, { align: 'auto' });
          }
        }
        return;
      }

      // Left arrow: collapse or step to parent
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Collapse only a genuinely expanded container. A filtered projection
        // may display matching children while the persisted set says
        // collapsed; calling toggleExpand there would expand on Left.
        if (focusedNode && isContainer(focusedNode) && expanded.has(focusedNode.id)) {
          toggleExpand(focusedNode.id);
        } else if (focusedNode) {
          const parentId = entries[focusIdx]?.parentId;
          if (parentId) {
            const parentIdx = entries.findIndex((e) => e.node.id === parentId);
            if (parentIdx >= 0) {
              setFocusIdx(parentIdx);
              virtualizer.scrollToIndex(parentIdx, { align: 'auto' });
            }
          }
        }
        return;
      }

      // Home/End
      if (e.key === 'Home') {
        e.preventDefault();
        jumpToStart();
        const homeEntry = entries[0];
        if (!homeEntry) throw new Error('home entry not found');
        virtualizer.scrollToIndex(0, { align: 'start' });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        jumpToEnd(entries.length);
        const endEntry = entries[entries.length - 1];
        if (!endEntry) throw new Error('end entry not found');
        virtualizer.scrollToIndex(entries.length - 1, { align: 'end' });
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        if (isControlOwnedActivation(e.target)) return;
        e.preventDefault();
        if (focusedNode) {
          activateSelection(focusedNode.id);
        }
        return;
      }

      // Space: toggle selection
      if (e.key === ' ') {
        if (isControlOwnedActivation(e.target)) return;
        e.preventDefault();
        if (focusedNode) {
          toggleSelection(focusedNode.id, true, 'layers');
        }
        return;
      }

      // Ctrl+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }

      // F2: rename
      if (e.key === 'F2') {
        e.preventDefault();
        if (focusedNode) {
          startRename(focusedNode.id);
        }
        return;
      }

      // APG optional `*` (Shift+8 on most layouts): expand all closed
      // siblings at the focused row's level. Focus does not move. No
      // modifier beyond the layout's own Shift, and checked before
      // type-ahead so the character is never swallowed as a search prefix.
      if (e.key === '*' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (focusedNode) {
          expandSiblings(focusedNode.id);
        }
        return;
      }

      // Keyboard structural editing beyond sibling order: Ctrl+Alt+] indents
      // the focused selection into the container displayed above it,
      // Ctrl+Alt+[ outdents it below its container's block. Same physical
      // keys as the sibling reorder but with Alt — level change vs position
      // change. Free in the global registry (Alt alone rotates the view);
      // see layerIndentPlan.ts for the order model.
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        if (e.key === ']') {
          indentSelection();
        } else {
          outdentSelection();
        }
        return;
      }

      // Keyboard reorder: Ctrl+] is Bring Forward, Ctrl+[ is Send Backward —
      // the same bindings the global shortcut registry and the context menu
      // use. The previous branch had the two keys reversed and reparented only
      // the focused row, so a multi-selection moved one row at a time and the
      // focus index then pointed at a neighbour. Route through the one
      // canonical arrange transaction instead of a second implementation.
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        if (!entries[focusIdx]) return;
        arrangeSelection(e.key === ']' ? 'forward' : 'backward');
        return;
      }

      // Type-ahead: single character
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const matchIdx = handleTypeAhead(
          e.key,
          (i) => entries[i]?.node.name ?? '',
          focusIdx,
          entries.length,
        );
        if (matchIdx !== null) {
          setFocusIdx(matchIdx);
          const matchEntry = entries[matchIdx];
          if (!matchEntry) throw new Error('match entry not found');
          virtualizer.scrollToIndex(matchIdx, { align: 'auto' });
        }
      }
    },
    [
      entries,
      focusIdx,
      expanded,
      isolatedNodeId,
      exitIsolation,
      doKeyboardMove,
      toggleExpand,
      toggleSelection,
      selectRange,
      activateSelection,
      setFocusIdx,
      jumpToStart,
      jumpToEnd,
      selectAll,
      handleTypeAhead,
      startRename,
      arrangeSelection,
      indentSelection,
      outdentSelection,
      expandSiblings,
      virtualizer,
      onContextMenuKeyboard,
    ],
  );

  return { handleKeyDown };
}
