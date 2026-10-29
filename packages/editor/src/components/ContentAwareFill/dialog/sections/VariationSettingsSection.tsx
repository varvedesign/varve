import type { DialogRuntime } from '../useDialogRuntime';

export function VariationSettingsSection({ controller }: { controller: DialogRuntime }) {
  const {
    hasResult,
    invalidatePreview,
    isProcessing,
    modeCapability,
    seed,
    setSeed,
    setVariationCount,
    variationCount,
  } = controller;
  return (
    <div className="caf-dialog__section">
      <label className="caf-dialog__label" htmlFor="caf-dialog-variation-count">
        Variations
      </label>
      <input
        id="caf-dialog-variation-count"
        type="number"
        min={1}
        max={modeCapability.limits.maxVariations}
        step={1}
        value={variationCount}
        onChange={(event) =>
          setVariationCount(
            Math.max(
              1,
              Math.min(modeCapability.limits.maxVariations, Number(event.target.value) || 1),
            ),
          )
        }
        disabled={!modeCapability.variations || hasResult || isProcessing}
      />
      <label className="caf-dialog__label" htmlFor="caf-dialog-seed">
        Seed <span className="caf-dialog__optional">optional</span>
      </label>
      <input
        id="caf-dialog-seed"
        type="number"
        value={seed ?? ''}
        placeholder="Random per generation"
        onChange={(event) => {
          const value = event.target.value.trim();
          setSeed(value === '' ? null : Number(value));
          invalidatePreview();
        }}
        disabled={isProcessing}
      />
    </div>
  );
}
