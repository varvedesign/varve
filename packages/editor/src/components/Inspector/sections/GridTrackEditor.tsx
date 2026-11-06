import {
  anchorGridPlacements,
  computeGridLayout,
  createGridTrack,
  ensureGridTrackIdentities,
  type GridTrackAxis,
  type GridTrackRemovalPreview,
  initializeGridTracks,
  previewRemoveGridTrack,
  reorderGridTrack,
  resizeGridTrack,
} from '@varve/layout';
import type { Document, GridItemPlacement, GridTrack, LayoutStyle } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../../../context';
import './GridTrackEditor.css';

interface GridTrackEditorProps {
  frameId: string;
  layoutStyle: LayoutStyle;
  document: Document;
}

function axisLabel(axis: GridTrackAxis): string {
  return axis === 'columns' ? 'column' : 'row';
}

function PreviewGrid({
  doc,
  frameId,
  style,
  label,
}: {
  doc: Document;
  frameId: string;
  style: LayoutStyle;
  label: string;
}) {
  const frame = doc.nodes[frameId];
  if (frame?.kind !== 'frame') return null;
  const items = computeGridLayout(doc, frameId, frame.w, frame.h, style, frame.children);
  const scale = Math.min(240 / Math.max(1, frame.w), 112 / Math.max(1, frame.h));
  return (
    <div className="insp-grid-track-editor__preview">
      <strong>{label}</strong>
      <div
        className="insp-grid-track-editor__preview-frame"
        style={{ width: Math.max(1, frame.w * scale), height: Math.max(1, frame.h * scale) }}
      >
        {items.map((item) => (
          <span
            key={item.id}
            title={doc.nodes[item.id]?.name ?? item.id}
            className="insp-grid-track-editor__preview-item"
            style={{
              left: item.x * scale,
              top: item.y * scale,
              width: Math.max(2, item.w * scale),
              height: Math.max(2, item.h * scale),
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function GridTrackEditor({ frameId, layoutStyle, document }: GridTrackEditorProps) {
  const { setGridTrackLayout } = useEditor();
  const editorRef = useRef<HTMLElement | null>(null);
  const removalDialogRef = useRef<HTMLDialogElement | null>(null);
  const removalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    axis: GridTrackAxis;
    preview: GridTrackRemovalPreview;
    sourceStyle: LayoutStyle;
    sourceDocument: Document;
  } | null>(null);
  const [trackErrors, setTrackErrors] = useState<Record<string, string>>({});
  const [axisErrors, setAxisErrors] = useState<Partial<Record<GridTrackAxis, string>>>({});
  const stableStyle = useMemo(
    () => ensureGridTrackIdentities(layoutStyle, frameId) ?? layoutStyle,
    [layoutStyle, frameId],
  );
  useEffect(() => {
    if (pendingRemoval) {
      removalDialogRef.current?.focus();
    } else if (removalTriggerRef.current) {
      const trigger = removalTriggerRef.current;
      removalTriggerRef.current = null;
      const bounds = trigger.getBoundingClientRect();
      const intersectsViewport =
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.right > 0 &&
        bounds.bottom > 0 &&
        bounds.left < globalThis.innerWidth &&
        bounds.top < globalThis.innerHeight;
      if (trigger.isConnected && !trigger.disabled && intersectsViewport) {
        trigger.focus();
      } else {
        const fallback = globalThis.document.querySelector<HTMLElement>(
          '[data-dialog-focus-fallback], canvas.editor-canvas__content-layer',
        );
        if (fallback) fallback.focus();
        else if (editorRef.current?.getClientRects().length) editorRef.current.focus();
      }
    }
  }, [pendingRemoval]);

  function tracks(axis: GridTrackAxis): GridTrack[] {
    return initializeGridTracks(stableStyle, axis, frameId) ?? [];
  }

  function commit(style: LayoutStyle) {
    setAxisErrors({});
    setGridTrackLayout(
      frameId,
      style,
      anchorGridPlacements(document, frameId, stableStyle),
      layoutStyle,
      document,
    );
  }

  function updateTrack(axis: GridTrackAxis, trackId: string, size: string) {
    const errorKey = `${axis}:${trackId}`;
    const existing = tracks(axis).find((track) => track.id === trackId);
    if (existing?.size === size.trim()) {
      setTrackErrors((current) => {
        if (!(errorKey in current)) return current;
        const next = { ...current };
        delete next[errorKey];
        return next;
      });
      return;
    }
    const next = resizeGridTrack(stableStyle, axis, frameId, trackId, size);
    if (!next) {
      setTrackErrors((current) => ({
        ...current,
        [errorKey]: 'Use auto, a nonnegative px value, or a positive fr value.',
      }));
      return;
    }
    setTrackErrors((current) => {
      if (!(errorKey in current)) return current;
      const cleared = { ...current };
      delete cleared[errorKey];
      return cleared;
    });
    commit(next);
  }

  function addTrack(axis: GridTrackAxis) {
    const next = createGridTrack(stableStyle, axis, frameId);
    if (next) commit(next);
    else
      setAxisErrors((current) => ({
        ...current,
        [axis]: 'Cannot add a track: repair the template or reduce the track count.',
      }));
  }

  function moveTrack(axis: GridTrackAxis, trackId: string, targetIndex: number) {
    const frame = document.nodes[frameId];
    const placements =
      frame?.kind === 'frame'
        ? frame.children
            .map((childId) => document.nodes[childId]?.gridPlacement)
            .filter((placement): placement is GridItemPlacement => placement != null)
        : [];
    const next = reorderGridTrack(stableStyle, axis, frameId, trackId, targetIndex, placements);
    if (next) commit(next);
    else
      setAxisErrors((current) => ({
        ...current,
        [axis]: 'Cannot move this track while a placed item spans the tracks it would cross.',
      }));
  }

  function renderAxis(axis: GridTrackAxis) {
    const list = tracks(axis);
    return (
      <section className="insp-grid-track-editor__axis" aria-label={`${axisLabel(axis)} tracks`}>
        <header>
          <strong>{axis === 'columns' ? 'Columns' : 'Rows'}</strong>
          <button type="button" onClick={() => addTrack(axis)} disabled={list.length >= 128}>
            Add {axisLabel(axis)}
          </button>
        </header>
        {axisErrors[axis] && (
          <small className="insp-grid-track-editor__error" role="alert">
            {axisErrors[axis]}
          </small>
        )}
        {list.length === 0 && (
          <p>No authored tracks. The grid creates tracks as items are placed.</p>
        )}
        {list.map((track, index) => {
          const errorKey = `${axis}:${track.id}`;
          const error = trackErrors[errorKey];
          const errorId = `grid-track-error-${frameId}-${axis}-${track.id}`;
          return (
            <div className="insp-grid-track-editor__entry" key={track.id}>
              <div className="insp-grid-track-editor__track">
                <span className="insp-grid-track-editor__index">{index + 1}</span>
                <input
                  aria-label={`${axisLabel(axis)} ${index + 1} size`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  key={`${track.id}:${track.size}`}
                  defaultValue={track.size}
                  onBlur={(event) => updateTrack(axis, track.id, event.currentTarget.value.trim())}
                  onChange={() => {
                    if (error) {
                      setTrackErrors((current) => {
                        const next = { ...current };
                        delete next[errorKey];
                        return next;
                      });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.value = track.size;
                      event.currentTarget.blur();
                      return;
                    }
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  className="insp-grid-track-editor__action"
                  aria-label={`Move ${axisLabel(axis)} ${index + 1} earlier`}
                  title={`Move ${axisLabel(axis)} earlier`}
                  onClick={() => moveTrack(axis, track.id, index - 1)}
                  disabled={index === 0}
                >
                  <Icon name="ChevronUp" label={undefined} size="0.8em" />
                </button>
                <button
                  type="button"
                  className="insp-grid-track-editor__action"
                  aria-label={`Move ${axisLabel(axis)} ${index + 1} later`}
                  title={`Move ${axisLabel(axis)} later`}
                  onClick={() => moveTrack(axis, track.id, index + 1)}
                  disabled={index === list.length - 1}
                >
                  <Icon name="ChevronDown" label={undefined} size="0.8em" />
                </button>
                <button
                  type="button"
                  className="insp-grid-track-editor__action"
                  aria-label={`Remove ${axisLabel(axis)} ${index + 1}`}
                  title={`Remove ${axisLabel(axis)}`}
                  disabled={list.length <= 1}
                  onClick={(event) => {
                    const preview = previewRemoveGridTrack(document, frameId, axis, track.id);
                    if (preview) {
                      setAxisErrors((current) => ({ ...current, [axis]: undefined }));
                      removalTriggerRef.current = event.currentTarget;
                      setPendingRemoval({
                        axis,
                        preview,
                        sourceStyle: layoutStyle,
                        sourceDocument: document,
                      });
                    } else
                      setAxisErrors((current) => ({
                        ...current,
                        [axis]:
                          'Cannot preview this removal: the grid is too large or has invalid track placements.',
                      }));
                  }}
                >
                  <Icon name="Trash2" label={undefined} size="0.8em" />
                </button>
              </div>
              {error && (
                <small id={errorId} className="insp-grid-track-editor__error" role="alert">
                  {error}
                </small>
              )}
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <section
      ref={editorRef}
      tabIndex={-1}
      className="insp-grid-track-editor"
      aria-label="Editable grid tracks"
    >
      {renderAxis('columns')}
      {renderAxis('rows')}
      {pendingRemoval &&
        createPortal(
          <dialog
            open
            ref={removalDialogRef}
            tabIndex={-1}
            className="insp-grid-track-editor__dialog"
            aria-labelledby="grid-track-removal-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPendingRemoval(null);
            }}
          >
            <h3 id="grid-track-removal-title">Preview track removal</h3>
            {!pendingRemoval.preview.valid && (
              <p role="alert">
                This removal creates an invalid or colliding placement. Nothing was changed.
              </p>
            )}
            {(pendingRemoval.sourceStyle !== layoutStyle ||
              pendingRemoval.sourceDocument !== document) && (
              <p role="alert">
                The grid changed since this preview opened. Cancel and review the current tracks
                before removing one.
              </p>
            )}
            <div className="insp-grid-track-editor__preview-pair">
              <PreviewGrid
                doc={pendingRemoval.sourceDocument}
                frameId={frameId}
                style={pendingRemoval.sourceStyle}
                label="Before"
              />
              <PreviewGrid
                doc={pendingRemoval.preview.resolvedDocument}
                frameId={frameId}
                style={pendingRemoval.preview.style}
                label="After"
              />
            </div>
            {pendingRemoval.preview.rehomes.length > 0 ? (
              <ul>
                {pendingRemoval.preview.rehomes.map((entry) => (
                  <li key={entry.nodeId}>
                    {pendingRemoval.sourceDocument.nodes[entry.nodeId]?.name ?? entry.nodeId}: cell
                    placement will move to a surviving {axisLabel(pendingRemoval.axis)} track.
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Anchored content remains in the same cell. Flow content will reflow against the
                remaining tracks.
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setPendingRemoval(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !pendingRemoval.preview.valid ||
                  pendingRemoval.sourceStyle !== layoutStyle ||
                  pendingRemoval.sourceDocument !== document
                }
                onClick={() => {
                  setGridTrackLayout(
                    frameId,
                    pendingRemoval.preview.style,
                    pendingRemoval.preview.placements,
                    pendingRemoval.sourceStyle,
                    pendingRemoval.sourceDocument,
                  );
                  setPendingRemoval(null);
                }}
              >
                Apply removal
              </button>
            </footer>
          </dialog>,
          globalThis.document.body,
        )}
    </section>
  );
}
