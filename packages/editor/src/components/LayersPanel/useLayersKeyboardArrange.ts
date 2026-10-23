/**
 * Keyboard arrange bookkeeping for the Layers tree.
 *
 * Ctrl+] / Ctrl+[ must be the same Bring Forward / Send Backward transaction
 * the global shortcuts and the row context menu use. Routing the tree through
 * `arrangeSelected` needs two pieces of state the old single-node reparent
 * call did not:
 *
 * - focus is an index into a projection that reorders, so it is restored by
 *   node id after the document commit instead of being left on a neighbour;
 * - arrange acts on the editor selection, so a focused-but-unselected row is
 *   selected first and the command runs once that selection has committed.
 *
 * Extracted from LayersTree to keep the panel's branch-complexity budget.
 */

import type { Virtualizer } from '@tanstack/react-virtual';
import type { NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef } from 'react';
import type { FlatEntry } from './useFlatTree';

export interface UseLayersKeyboardArrangeArgs {
  entries: FlatEntry[];
  focusIdx: number;
  selection: NodeId[];
  setFocusIdx: (idx: number) => void;
  setSelectionRefs: (ids: NodeId[], options: { primary: NodeId; origin: 'layers' }) => void;
  arrangeSelected: (op: 'forward' | 'backward') => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}

export type LayerArrangeOperation = 'forward' | 'backward';

export function useLayersKeyboardArrange({
  entries,
  focusIdx,
  selection,
  setFocusIdx,
  setSelectionRefs,
  arrangeSelected,
  virtualizer,
}: UseLayersKeyboardArrangeArgs): (op: LayerArrangeOperation) => void {
  const pendingFocusIdRef = useRef<NodeId | null>(null);
  const pendingOperationRef = useRef<LayerArrangeOperation | null>(null);

  // Restore focus by identity once the reordered projection has committed.
  useEffect(() => {
    const pending = pendingFocusIdRef.current;
    if (!pending) return;
    const idx = entries.findIndex((entry) => entry.node.id === pending);
    if (idx < 0) return;
    pendingFocusIdRef.current = null;
    setFocusIdx(idx);
    virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [entries, setFocusIdx, virtualizer]);

  // Run an arrange that needed the focused row selected first. This effect
  // fires after the selection commit, so `arrangeSelected` sees the target.
  useEffect(() => {
    const operation = pendingOperationRef.current;
    if (!operation) return;
    pendingOperationRef.current = null;
    arrangeSelected(operation);
  }, [selection, arrangeSelected]);

  return useCallback(
    (operation: LayerArrangeOperation) => {
      const focusedId = entries[focusIdx]?.node.id;
      if (!focusedId) return;
      pendingFocusIdRef.current = focusedId;
      if (!selection.includes(focusedId)) {
        pendingOperationRef.current = operation;
        setSelectionRefs([focusedId], { primary: focusedId, origin: 'layers' });
        return;
      }
      arrangeSelected(operation);
    },
    [entries, focusIdx, selection, setSelectionRefs, arrangeSelected],
  );
}
