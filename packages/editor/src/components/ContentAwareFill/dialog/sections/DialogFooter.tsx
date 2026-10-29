import { Button } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function DialogFooter({ controller }: { controller: DialogRuntime }) {
  const { errorMessage, handleApply, hasResult, isProcessing, onClose, result, status } =
    controller;
  return (
    <div className="caf-dialog__footer">
      <div className="caf-dialog__footer-info">
        {status === 'generating' && (
          <span className="caf-dialog__footer-text" aria-live="polite">
            Running fill…
          </span>
        )}
        {status === 'error' && errorMessage && (
          <span className="caf-dialog__footer-text caf-dialog__footer-text--error" role="alert">
            {errorMessage}
          </span>
        )}
        {status === 'idle' && hasResult && result?.warnings[0] && (
          <span className="caf-dialog__footer-text" title={result.warnings.join(' ')}>
            {result.provider.kind === 'local' ? 'Local result' : 'Provider result'} ·{' '}
            {result.warnings[0]}
          </span>
        )}
      </div>
      <div className="caf-dialog__footer-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!hasResult || isProcessing}
          loading={status === 'applying'}
          onClick={handleApply}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
