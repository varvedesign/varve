import { Button } from '@varve/ui';
import type { DialogRuntime } from '../useDialogRuntime';

export function MaskSourceSection({ controller }: { controller: DialogRuntime }) {
  const {
    announce,
    areaSelection,
    backgroundRemovalPreview,
    handleInvertMask,
    handleStartObjectSelection,
    handleUseBackgroundRemovalPreview,
    handleUseImageAlpha,
    handleUseLayerMask,
    handleUseObjectSelection,
    handleUsePixelSelection,
    hasMaskStrokes,
    hasResult,
    imageSrc,
    isProcessing,
    layerMaskAsset,
    maskHealth,
    maskOperation,
    maskOrigin,
    mode,
    naturalSize,
    objectSelection,
    objectSelectionCandidate,
    objectSelectionCandidateNeedsRefinement,
    objectSelectionInitialReviewMissing,
    objectSelectionMappingMatchesCurrent,
    objectSelectionNeedsRefinement,
    objectSelectionReviewKey,
    reviewedObjectSelectionKey,
    setMaskOperation,
    setReviewedObjectSelectionAt,
    setReviewedObjectSelectionKey,
  } = controller;
  return (
    <div className="caf-dialog__section">
      <span className="caf-dialog__label">Mask source</span>
      <div className="caf-dialog__mask-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUsePixelSelection}
          disabled={!areaSelection || hasResult || isProcessing}
        >
          Use Pixel Selection
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUseObjectSelection}
          disabled={
            objectSelection?.status !== 'ready' ||
            objectSelectionInitialReviewMissing ||
            !objectSelectionMappingMatchesCurrent ||
            objectSelectionCandidateNeedsRefinement ||
            hasResult ||
            isProcessing
          }
        >
          Use Object Selection
        </Button>
        {objectSelection?.status === 'ready' && objectSelectionInitialReviewMissing && (
          <span className="caf-dialog__hint" role="status">
            Review the highlighted target in Object Selection before importing this mask.
          </span>
        )}
        {objectSelection?.status === 'ready' && !objectSelectionMappingMatchesCurrent && (
          <span className="caf-dialog__hint" role="status">
            The image placement changed after Object Selection. Recreate the preview before
            importing this mask.
          </span>
        )}
        {objectSelection?.status !== 'ready' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleStartObjectSelection}
            disabled={hasMaskStrokes || hasResult || isProcessing}
          >
            Start Object Selection
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleUseLayerMask()}
          disabled={!layerMaskAsset || hasResult || isProcessing}
        >
          Use Layer Mask
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleUseBackgroundRemovalPreview()}
          disabled={
            !backgroundRemovalPreview ||
            naturalSize.w <= 0 ||
            naturalSize.h <= 0 ||
            hasResult ||
            isProcessing
          }
        >
          Use Background Removal Preview
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleUseImageAlpha()}
          disabled={!imageSrc || hasResult || isProcessing}
        >
          Use Image Alpha
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleInvertMask}
          disabled={!hasMaskStrokes || hasResult || isProcessing}
        >
          Invert
        </Button>
      </div>
      {objectSelectionCandidateNeedsRefinement && (
        <p className="caf-dialog__mask-health-warning" role="status">
          This Object Selection candidate reaches an image edge without an extent prompt. Refine it
          with an include point on that edge or a box around the full target before using it for
          generation.
        </p>
      )}
      <fieldset className="caf-dialog__mask-operations">
        <legend className="caf-dialog__label">Mask operation</legend>
        {(
          [
            ['replace', 'Replace'],
            ['add', 'Add'],
            ['subtract', 'Subtract'],
            ['intersect', 'Intersect'],
          ] as const
        ).map(([operation, label]) => (
          <button
            key={operation}
            type="button"
            className={`caf-dialog__mask-operation${maskOperation === operation ? ' caf-dialog__mask-operation--active' : ''}`}
            aria-pressed={maskOperation === operation}
            disabled={hasResult || isProcessing}
            onClick={() => {
              setMaskOperation(operation);
              announce(`Mask operation: ${label}`);
            }}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <p className="caf-dialog__hint" aria-live="polite">
        {maskOrigin === 'pixel-selection'
          ? 'Using the current document pixel selection.'
          : maskOrigin === 'layer-mask'
            ? 'Using the selected image layer mask.'
            : maskOrigin === 'image-alpha'
              ? 'Using the source image alpha channel.'
              : maskOrigin === 'object-selection'
                ? 'Using the confirmed Object Selection candidate; refine it with the brush.'
                : maskOrigin === 'background-removal'
                  ? 'Using the Background Removal preview as an editable mask; refine it with the brush before generating.'
                  : maskOrigin === 'persisted'
                    ? 'Using the accepted edit mask.'
                    : 'Paint directly on the source to define the edit region.'}
      </p>
      <div className="caf-dialog__mask-health" role="status" aria-live="polite">
        {mode === 'expand' ? (
          <span>Expansion uses the output padding below; the source image remains protected.</span>
        ) : maskHealth.coveredPixels === 0 ? (
          <span>No pixels selected.</span>
        ) : (
          <span>
            {Math.round(maskHealth.coverage * 100)}% selected · {maskHealth.componentCount}{' '}
            {maskHealth.componentCount === 1 ? 'region' : 'regions'} ·{' '}
            {maskHealth.bounds
              ? `${maskHealth.bounds.width} x ${maskHealth.bounds.height} px bounds`
              : 'no bounds'}
          </span>
        )}
        {maskHealth.blockingReason && mode !== 'expand' && (
          <span className="caf-dialog__mask-health-error">{maskHealth.blockingReason}</span>
        )}
        {maskHealth.warnings.map((warning) => (
          <span key={warning} className="caf-dialog__mask-health-warning">
            {warning}
          </span>
        ))}
        {maskOrigin === 'object-selection' && objectSelectionCandidate?.promptDiagnostics && (
          <>
            <span>
              Target evidence{' '}
              {Math.round(
                Math.max(
                  0,
                  Math.min(1, objectSelectionCandidate.promptDiagnostics.anchoredCoverage),
                ) * 100,
              )}
              % anchored · {objectSelectionCandidate.promptDiagnostics.componentCount}{' '}
              {objectSelectionCandidate.promptDiagnostics.componentCount === 1
                ? 'connected region'
                : 'connected regions'}
            </span>
            {objectSelectionCandidate.promptDiagnostics.warnings.map((warning) => (
              <span key={warning} className="caf-dialog__mask-health-warning">
                {warning}
              </span>
            ))}
          </>
        )}
        {maskOrigin === 'object-selection' && !objectSelectionCandidate && (
          <span className="caf-dialog__mask-health-error">
            The Object Selection candidate is no longer available. Choose another mask source or
            clear and recreate the selection.
          </span>
        )}
        {maskOrigin === 'object-selection' && objectSelectionCandidate && (
          <label className="caf-dialog__checkbox">
            <input
              type="checkbox"
              checked={
                objectSelectionReviewKey !== null &&
                reviewedObjectSelectionKey === objectSelectionReviewKey
              }
              disabled={
                objectSelectionReviewKey === null ||
                objectSelectionNeedsRefinement ||
                !objectSelectionMappingMatchesCurrent
              }
              onChange={(event) => {
                setReviewedObjectSelectionKey(
                  event.target.checked ? objectSelectionReviewKey : null,
                );
                setReviewedObjectSelectionAt(event.target.checked ? Date.now() : null);
              }}
            />
            <span>
              {objectSelectionNeedsRefinement
                ? 'Refine the highlighted edge extent before generating'
                : objectSelectionCandidate?.promptDiagnostics?.ambiguous === true
                  ? 'I reviewed every highlighted target region before generating'
                  : 'I reviewed the highlighted target before generating'}
            </span>
          </label>
        )}
        {maskOrigin === 'object-selection' &&
          objectSelectionCandidate &&
          !objectSelectionReviewKey && (
            <span className="caf-dialog__mask-health-error">
              This Object Selection preview is too old to verify. Create a new preview before
              generating.
            </span>
          )}
      </div>
    </div>
  );
}
