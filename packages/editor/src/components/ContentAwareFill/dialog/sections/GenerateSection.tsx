import { Button } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function GenerateSection({ controller }: { controller: DialogRuntime }) {
  const {
    canGenerate,
    generationProgress,
    generationStage,
    handleCancelDownload,
    handleCancelQualification,
    handleGenerate,
    hasResult,
    isProcessing,
    jobControllerRef,
    mode,
    modeAvailable,
    setStatus,
    status,
  } = controller;
  return (
    <div className="caf-dialog__section caf-dialog__section--grow">
      {isProcessing ? (
        <div className="caf-dialog__status">
          <span aria-live="polite">
            {status === 'qualifying'
              ? 'Validating local diffusion model…'
              : status === 'generating'
                ? `${generationStage}… ${Math.round(generationProgress * 100)}%`
                : 'Applying…'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (status === 'downloading') {
                handleCancelDownload();
              } else if (status === 'qualifying') {
                handleCancelQualification();
              } else {
                jobControllerRef.current.cancel();
                setStatus('idle');
              }
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!modeAvailable || !canGenerate}
          onClick={handleGenerate}
        >
          {hasResult
            ? 'Regenerate'
            : mode === 'remove'
              ? 'Remove && Fill'
              : `${mode[0]?.toUpperCase()}${mode.slice(1)}`}
        </Button>
      )}
    </div>
  );
}
