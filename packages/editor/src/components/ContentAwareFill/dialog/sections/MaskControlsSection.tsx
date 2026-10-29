import type { DialogRuntime } from '../useDialogRuntime';

export function MaskControlsSection({ controller }: { controller: DialogRuntime }) {
  const {
    brushSize,
    contextPadding,
    invalidatePreview,
    maskExpansion,
    maskFeather,
    setBrushSize,
    setContextPadding,
    setMaskExpansion,
    setMaskFeather,
  } = controller;
  return (
    <>
      <div className="caf-dialog__section">
        <label className="caf-dialog__label" htmlFor="caf-dialog-brush">
          Brush: {brushSize}px
        </label>
        <input
          id="caf-dialog-brush"
          type="range"
          className="varve-native-range caf-dialog__range"
          min={8}
          max={80}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
        />
      </div>

      <div className="caf-dialog__refinement-grid">
        <div className="caf-dialog__section">
          <label className="caf-dialog__label" htmlFor="caf-dialog-mask-expansion">
            {maskExpansion < 0 ? 'Shrink mask' : 'Grow mask'}: {Math.abs(maskExpansion)}px
          </label>
          <input
            id="caf-dialog-mask-expansion"
            type="range"
            className="varve-native-range caf-dialog__range"
            min={-64}
            max={64}
            step={1}
            value={maskExpansion}
            onChange={(event) => {
              setMaskExpansion(Number(event.target.value));
              invalidatePreview();
            }}
          />
        </div>
        <div className="caf-dialog__section">
          <label className="caf-dialog__label" htmlFor="caf-dialog-mask-feather">
            Feather: {maskFeather}px
          </label>
          <input
            id="caf-dialog-mask-feather"
            type="range"
            className="varve-native-range caf-dialog__range"
            min={0}
            max={64}
            step={1}
            value={maskFeather}
            onChange={(event) => {
              setMaskFeather(Number(event.target.value));
              invalidatePreview();
            }}
          />
        </div>
        <div className="caf-dialog__section">
          <label className="caf-dialog__label" htmlFor="caf-dialog-context-padding">
            Context: {contextPadding}px
          </label>
          <input
            id="caf-dialog-context-padding"
            type="range"
            className="varve-native-range caf-dialog__range"
            min={8}
            max={256}
            step={8}
            value={contextPadding}
            onChange={(event) => {
              setContextPadding(Number(event.target.value));
              invalidatePreview();
            }}
          />
        </div>
      </div>
    </>
  );
}
