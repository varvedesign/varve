import { Button, Switch } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function MaskStateSection({ controller }: { controller: DialogRuntime }) {
  const {
    handleClearMask,
    handleEditMask,
    hasMaskStrokes,
    hasResult,
    isProcessing,
    maskVisible,
    setMaskVisible,
  } = controller;
  return (
    <>
      {!hasResult && (
        <div className="caf-dialog__section">
          <Switch
            className="caf-dialog__checkbox"
            label="Show mask overlay"
            checked={maskVisible}
            onChange={(e) => setMaskVisible(e.target.checked)}
          />
        </div>
      )}

      {hasResult && (
        <div className="caf-dialog__section">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleEditMask}
            disabled={isProcessing}
          >
            Edit mask
          </Button>
        </div>
      )}

      <div className="caf-dialog__section">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearMask}
          disabled={!hasMaskStrokes || hasResult || isProcessing}
        >
          Clear Paint
        </Button>
      </div>
    </>
  );
}
