import { Button } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function ModelDownloadSection({ controller }: { controller: DialogRuntime }) {
  const {
    downloadProgress,
    handleCancelDownload,
    handleDownload,
    modelAvailable,
    modelFitsMemory,
    quality,
    status,
  } = controller;
  return (
    <>
      {quality === 'ai' &&
        modelFitsMemory !== false &&
        !modelAvailable &&
        status !== 'downloading' && (
          <div className="caf-dialog__section">
            <Button type="button" variant="default" size="sm" onClick={handleDownload}>
              Download AI Model (~208 MB)
            </Button>
            <p className="caf-dialog__hint">One-time download required. Stored locally.</p>
          </div>
        )}
      {quality === 'ai' && modelFitsMemory === false && (
        <p className="caf-dialog__hint" role="status">
          AI quality is unavailable on this device's current memory budget. Choose Fast / Quick
          Cleanup; it runs without loading a model and remains suitable for small repairs.
        </p>
      )}

      {status === 'downloading' && (
        <div className="caf-dialog__section">
          <div
            className="caf-dialog__progress"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="caf-dialog__progress-fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p className="caf-dialog__hint" aria-live="polite">
            Downloading… {downloadProgress}%
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}
