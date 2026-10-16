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
import type { Document, GridTrack, LayoutStyle } from '@varve/scene';
import { useMemo, useState } from 'react';
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
  const [pendingRemoval, setPendingRemoval] = useState<{
    axis: GridTrackAxis;
    preview: GridTrackRemovalPreview;
  } | null>(null);
  const stableStyle = useMemo(
    () => ensureGridTrackIdentities(layoutStyle, frameId) ?? layoutStyle,
    [layoutStyle, frameId],
  );

  function tracks(axis: GridTrackAxis): GridTrack[] {
    return initializeGridTracks(stableStyle, axis, frameId) ?? [];
  }

  function commit(style: LayoutStyle) {
    setGridTrackLayout(frameId, style, anchorGridPlacements(document, frameId, stableStyle));
  }

  function updateTrack(axis: GridTrackAxis, trackId: string, size: string) {
    const existing = tracks(axis).find((track) => track.id === trackId);
    if (existing?.size === size.trim()) return;
    const next = resizeGridTrack(stableStyle, axis, frameId, trackId, size);
    if (next) commit(next);
  }

  function addTrack(axis: GridTrackAxis) {
    const next = createGridTrack(stableStyle, axis, frameId);
    if (next) commit(next);
  }

  function moveTrack(axis: GridTrackAxis, trackId: string, targetIndex: number) {
    const next = reorderGridTrack(stableStyle, axis, frameId, trackId, targetIndex);
    if (next) commit(next);
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
        {list.length === 0 && (
          <p>No authored tracks. The grid creates tracks as items are placed.</p>
        )}
        {list.map((track, index) => (
          <div className="insp-grid-track-editor__track" key={track.id}>
            <span className="insp-grid-track-editor__index">{index + 1}</span>
            <input
              aria-label={`${axisLabel(axis)} ${index + 1} size`}
              key={`${track.id}:${track.size}`}
              defaultValue={track.size}
              onBlur={(event) => updateTrack(axis, track.id, event.currentTarget.value.trim())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <button
              type="button"
              aria-label={`Move ${axisLabel(axis)} ${index + 1} earlier`}
              onClick={() => moveTrack(axis, track.id, index - 1)}
              disabled={index === 0}
            >
              Move up
            </button>
            <button
              type="button"
              aria-label={`Move ${axisLabel(axis)} ${index + 1} later`}
              onClick={() => moveTrack(axis, track.id, index + 1)}
              disabled={index === list.length - 1}
            >
              Move down
            </button>
            <button
              type="button"
              aria-label={`Remove ${axisLabel(axis)} ${index + 1}`}
              disabled={list.length <= 1}
              onClick={() => {
                const preview = previewRemoveGridTrack(document, frameId, axis, track.id);
                if (preview) setPendingRemoval({ axis, preview });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="insp-grid-track-editor" aria-label="Editable grid tracks">
      {renderAxis('columns')}
      {renderAxis('rows')}
      {pendingRemoval && (
        <dialog
          open
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
          <div className="insp-grid-track-editor__preview-pair">
            <PreviewGrid doc={document} frameId={frameId} style={layoutStyle} label="Before" />
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
                  {document.nodes[entry.nodeId]?.name ?? entry.nodeId}: cell placement will move to
                  a surviving {axisLabel(pendingRemoval.axis)} track.
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
              disabled={!pendingRemoval.preview.valid}
              onClick={() => {
                setGridTrackLayout(
                  frameId,
                  pendingRemoval.preview.style,
                  pendingRemoval.preview.placements,
                );
                setPendingRemoval(null);
              }}
            >
              Apply removal
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
