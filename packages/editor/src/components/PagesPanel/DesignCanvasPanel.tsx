/**
 * Design Canvas navigator.
 *
 * Design Canvases are document-level surfaces, so this panel owns their
 * navigation and lifecycle. Their transparent content roots are deliberately
 * not handed to LayersTree; only the active canvas's artwork belongs there.
 */

import type { DesignCanvas, NodeId } from '@varve/scene';
import {
  createDesignCanvas,
  deleteDesignCanvas,
  duplicateDesignCanvas,
  renameDesignCanvas,
  reorderDesignCanvases,
  setActiveDesignCanvas,
} from '@varve/scene';
import { IconButton, InfoHint } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../context';
import { confirmDialog, promptDialog } from '../PromptDialog';
import { SectionCollapseToggle } from '../SectionCollapseToggle';
import { usePersistedDisclosure } from '../usePersistedDisclosure';
import { DesignCanvasActions } from './DesignCanvasActions';
import './pages-panel.css';

function orderedCanvases(canvases: DesignCanvas[] | undefined): DesignCanvas[] {
  return [...(canvases ?? [])].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

export function DesignCanvasPanel() {
  const { state, updateDoc, setSelection, announce } = useEditor();
  const [collapsed, setCollapsed] = usePersistedDisclosure('design-canvases');
  const canvases = useMemo(
    () => orderedCanvases(state.document.designCanvases),
    [state.document.designCanvases],
  );
  const activeId = state.document.activeDesignCanvasId ?? canvases[0]?.id;

  const activate = useCallback(
    (canvasId: NodeId) => {
      if (canvasId === state.document.activeDesignCanvasId) return;
      const canvas = canvases.find((candidate) => candidate.id === canvasId);
      updateDoc((doc) => setActiveDesignCanvas(doc, canvasId));
      // Selection belongs to the visible surface. Keeping a selection from a
      // different canvas would make inspector actions target hidden artwork.
      setSelection(null);
      if (canvas) announce(`Design Canvas changed to ${canvas.name}`);
    },
    [announce, canvases, setSelection, state.document.activeDesignCanvasId, updateDoc],
  );

  const addCanvas = useCallback(() => {
    let createdId: NodeId | undefined;
    updateDoc((doc) => {
      const next = createDesignCanvas(doc);
      createdId = next.activeDesignCanvasId;
      return next;
    });
    setSelection(null);
    if (createdId) announce('New Design Canvas created');
  }, [announce, setSelection, updateDoc]);

  const renameCanvas = useCallback(
    async (canvas: DesignCanvas) => {
      const nextName = await promptDialog('Rename Design Canvas', canvas.name);
      if (nextName === null || !nextName.trim()) return;
      updateDoc((doc) => renameDesignCanvas(doc, canvas.id, nextName));
      announce(`Design Canvas renamed to ${nextName.trim()}`);
    },
    [announce, updateDoc],
  );

  const duplicateCanvas = useCallback(
    (canvasId: NodeId) => {
      updateDoc((doc) => duplicateDesignCanvas(doc, canvasId));
      setSelection(null);
      announce('Design Canvas duplicated');
    },
    [announce, setSelection, updateDoc],
  );

  const removeCanvas = useCallback(
    async (canvas: DesignCanvas) => {
      const remaining = canvases.filter((candidate) => candidate.id !== canvas.id);
      const destination = remaining[0];
      const message = destination
        ? `Remove “${canvas.name}”? Its artwork will move to “${destination.name}”.`
        : `Remove “${canvas.name}”? Its artwork will move to the pasteboard.`;
      const confirmed = await confirmDialog('Remove Design Canvas', message, {
        confirmLabel: 'Remove Canvas',
        variant: 'destructive',
      });
      if (!confirmed) return;
      updateDoc((doc) =>
        deleteDesignCanvas(
          doc,
          canvas.id,
          destination ? 'move-to-canvas' : 'move-to-pasteboard',
          destination?.id,
        ),
      );
      setSelection(null);
      announce(`Design Canvas ${canvas.name} removed`);
    },
    [announce, canvases, setSelection, updateDoc],
  );

  const moveCanvas = useCallback(
    (canvasId: NodeId, direction: -1 | 1) => {
      const index = canvases.findIndex((canvas) => canvas.id === canvasId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= canvases.length) return;
      const ids = canvases.map((canvas) => canvas.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(target, 0, moved as NodeId);
      updateDoc((doc) => reorderDesignCanvases(doc, ids));
    },
    [canvases, updateDoc],
  );

  return (
    <section className="pages-panel design-canvas-panel" aria-label="Design Canvases">
      <div className="pages-panel__header">
        <h3 className="pages-panel__title" aria-label="Design Canvases">
          <SectionCollapseToggle
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
            label="Design Canvases section"
            controls={collapsed ? undefined : 'design-canvas-list'}
          />
          Canvases
          <span className="pages-panel__count">{canvases.length}</span>
          <InfoHint topic="Design Canvases">
            Unbounded work surfaces for exploration and UI design. Publishing Pages live in Print.
          </InfoHint>
        </h3>
        <IconButton
          icon="Plus"
          size="icon-xs"
          variant="default"
          onClick={addCanvas}
          label="Add Design Canvas"
        />
      </div>
      {!collapsed && (
        <ul
          id="design-canvas-list"
          className="pages-panel__list design-canvas-panel__list"
          aria-label="Design Canvas list"
        >
          {canvases.map((canvas, index) => (
            <li
              key={canvas.id}
              className={`design-canvas-panel__row${canvas.id === activeId ? ' design-canvas-panel__row--active' : ''}`}
            >
              <button
                type="button"
                className="design-canvas-panel__select"
                onClick={() => activate(canvas.id)}
                onDoubleClick={() => void renameCanvas(canvas)}
                aria-current={canvas.id === activeId ? 'true' : undefined}
                title={`${canvas.name} — double-click to rename`}
              >
                <span className="design-canvas-panel__canvas-mark" aria-hidden="true" />
                <span className="design-canvas-panel__name">{canvas.name}</span>
              </button>
              <DesignCanvasActions
                name={canvas.name}
                first={index === 0}
                last={index === canvases.length - 1}
                onRename={() => void renameCanvas(canvas)}
                onDuplicate={() => duplicateCanvas(canvas.id)}
                onMove={(direction) => moveCanvas(canvas.id, direction)}
                onRemove={() => void removeCanvas(canvas)}
              />
            </li>
          ))}
          {canvases.length === 0 && (
            <li className="pages-panel__empty">No Design Canvases — click + to create one.</li>
          )}
        </ul>
      )}
    </section>
  );
}
