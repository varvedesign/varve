import type { DialogRuntime } from '../useDialogRuntime';

export function DiffusionRefinementSection({ controller }: { controller: DialogRuntime }) {
  const {
    guidanceScale,
    imageGuidanceScale,
    invalidatePreview,
    isProcessing,
    modeCapability,
    setGuidanceScale,
    setImageGuidanceScale,
    setSteps,
    setStrength,
    steps,
    strength,
    usesDiffusion,
  } = controller;
  return (
    <>
      {usesDiffusion && (
        <div className="caf-dialog__refinement-grid">
          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-strength">
              Strength: {Math.round(strength * 100)}%
            </label>
            <input
              id="caf-dialog-strength"
              type="range"
              className="varve-native-range caf-dialog__range"
              min={0.1}
              max={1}
              step={0.05}
              value={strength}
              onChange={(event) => {
                setStrength(Number(event.target.value));
                invalidatePreview();
              }}
              disabled={isProcessing}
            />
          </div>
          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-steps">
              Steps: {steps}
            </label>
            <input
              id="caf-dialog-steps"
              type="range"
              className="varve-native-range caf-dialog__range"
              min={4}
              max={100}
              step={1}
              value={steps}
              onChange={(event) => {
                setSteps(Number(event.target.value));
                invalidatePreview();
              }}
              disabled={isProcessing}
            />
          </div>
          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-guidance">
              Guidance: {guidanceScale}
            </label>
            <input
              id="caf-dialog-guidance"
              type="range"
              className="varve-native-range caf-dialog__range"
              min={0}
              max={20}
              step={0.5}
              value={guidanceScale}
              onChange={(event) => {
                setGuidanceScale(Number(event.target.value));
                invalidatePreview();
              }}
              disabled={isProcessing}
            />
          </div>
          {modeCapability.supportedParameters.includes('imageGuidanceScale') && (
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-image-guidance">
                Image guidance: {imageGuidanceScale}
              </label>
              <input
                id="caf-dialog-image-guidance"
                type="range"
                className="varve-native-range caf-dialog__range"
                min={0}
                max={20}
                step={0.5}
                value={imageGuidanceScale}
                onChange={(event) => {
                  setImageGuidanceScale(Number(event.target.value));
                  invalidatePreview();
                }}
                disabled={isProcessing}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
