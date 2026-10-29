import type { DialogRuntime } from '../useDialogRuntime';

export function VariationsFieldset({ controller }: { controller: DialogRuntime }) {
  const {
    activeVariationId,
    generationRef,
    handleDeleteVariation,
    isProcessing,
    isRefiningMask,
    setActiveVariationId,
    setPreviewDataUrl,
    setResult,
    variations,
  } = controller;
  return (
    <>
      {variations.length > 0 && (
        <fieldset className="caf-dialog__section caf-dialog__variations-fieldset">
          <legend className="caf-dialog__label">Variations</legend>
          <div className="caf-dialog__variations">
            {variations.map((variation, index) => (
              <div className="caf-dialog__variation-card" key={variation.id}>
                <button
                  type="button"
                  className={`caf-dialog__variation${activeVariationId === variation.id ? ' caf-dialog__variation--active' : ''}`}
                  disabled={isRefiningMask || isProcessing}
                  onClick={() => {
                    setActiveVariationId(variation.id);
                    setResult(variation.result);
                    setPreviewDataUrl(variation.dataUrl);
                    if (generationRef.current) {
                      generationRef.current.result = variation.result;
                      generationRef.current.seed = variation.seed;
                      generationRef.current.patchDataUrl = variation.patchDataUrl;
                      generationRef.current.patchWidth = variation.patchWidth;
                      generationRef.current.patchHeight = variation.patchHeight;
                      generationRef.current.patchFrame = variation.patchFrame;
                      generationRef.current.assetKind = variation.assetKind;
                    }
                  }}
                  aria-label={`Variation ${index + 1}`}
                  aria-pressed={activeVariationId === variation.id}
                >
                  <img
                    src={variation.thumbnailDataUrl ?? variation.dataUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span>{index + 1}</span>
                </button>
                <button
                  type="button"
                  className="caf-dialog__variation-delete"
                  aria-label={`Delete variation ${index + 1}`}
                  disabled={variations.length <= 1 || isProcessing}
                  onClick={() => handleDeleteVariation(variation.id, index + 1)}
                >
                  {String.fromCharCode(215)}
                </button>
              </div>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
