import type { DialogRuntime } from '../useDialogRuntime';

export function PreviewToolbar({ controller }: { controller: DialogRuntime }) {
  const {
    adjustZoom,
    centerPreview,
    hasResult,
    previewZoom,
    selectFitZoom,
    selectOneToOneZoom,
    setShowOriginal,
    showOriginal,
    zoomPercent,
  } = controller;
  return (
    <div className="caf-dialog__preview-toolbar">
      <div className="caf-dialog__preview-toggles">
        {hasResult && (
          <button
            type="button"
            className={`caf-dialog__toggle-btn${showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
            onClick={() => setShowOriginal(true)}
          >
            Original
          </button>
        )}
        {hasResult && (
          <button
            type="button"
            className={`caf-dialog__toggle-btn${!showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
            onClick={() => setShowOriginal(false)}
          >
            Result
          </button>
        )}
        {!hasResult && <span className="caf-dialog__preview-label">Source</span>}
      </div>
      <div className="caf-dialog__preview-zoom">
        <button
          type="button"
          className="caf-dialog__zoom-btn"
          aria-label="Zoom out"
          onClick={() => adjustZoom(-25)}
          disabled={previewZoom === 'custom' && zoomPercent <= 25}
        >
          −
        </button>
        <span className="caf-dialog__zoom-value" aria-live="polite">
          {previewZoom === 'fit' ? 'Fit' : `${zoomPercent}%`}
        </span>
        <button
          type="button"
          className="caf-dialog__zoom-btn"
          aria-label="Zoom in"
          onClick={() => adjustZoom(25)}
          disabled={previewZoom === 'custom' && zoomPercent >= 400}
        >
          +
        </button>
        <button
          type="button"
          className={`caf-dialog__zoom-btn${previewZoom === 'fit' ? ' caf-dialog__zoom-btn--active' : ''}`}
          onClick={selectFitZoom}
        >
          Fit
        </button>
        <button
          type="button"
          className={`caf-dialog__zoom-btn${previewZoom === 'custom' && zoomPercent === 100 ? ' caf-dialog__zoom-btn--active' : ''}`}
          onClick={selectOneToOneZoom}
        >
          1:1
        </button>
        <button
          type="button"
          className="caf-dialog__zoom-btn"
          aria-label="Center preview"
          onClick={centerPreview}
        >
          Center
        </button>
      </div>
    </div>
  );
}
