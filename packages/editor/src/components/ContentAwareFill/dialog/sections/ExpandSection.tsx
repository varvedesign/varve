import { estimateExpandGenerationResolution } from '@varve/engine';
import { Button, NativeSelect } from '@varve/ui';
import {
  EXPAND_ASPECT_PRESETS,
  type ExpandAnchor,
  expandPaddingForAspectRatio,
  expandPaddingForOutputSize,
} from '../../expandControls';
import type { DialogRuntime } from '../useDialogRuntime';

export function ExpandSection({ controller }: { controller: DialogRuntime }) {
  const {
    expandAnchor,
    expandAspectRatio,
    expandPadding,
    expandPlanPreview,
    expandTargetHeight,
    expandTargetWidth,
    invalidatePreview,
    isProcessing,
    mode,
    naturalSize,
    setErrorMessage,
    setExpandAnchor,
    setExpandAspectRatio,
    setExpandPadding,
    setExpandTargetHeight,
    setExpandTargetWidth,
  } = controller;
  return (
    <>
      {mode === 'expand' && (
        <div className="caf-dialog__section">
          <span className="caf-dialog__label">Expansion (source pixels)</span>
          <div className="caf-dialog__expand-presets">
            <NativeSelect
              className="caf-dialog__expand-control"
              id="caf-expand-aspect-ratio"
              label="Aspect ratio"
              value={expandAspectRatio}
              onValueChange={setExpandAspectRatio}
              disabled={isProcessing}
              options={EXPAND_ASPECT_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
            />
            <NativeSelect
              className="caf-dialog__expand-control"
              id="caf-expand-anchor"
              label="Source anchor"
              value={expandAnchor}
              onValueChange={(value) => setExpandAnchor(value as ExpandAnchor)}
              disabled={isProcessing}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'top-left', label: 'Top left' },
                { value: 'top', label: 'Top' },
                { value: 'top-right', label: 'Top right' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'bottom-right', label: 'Bottom right' },
              ]}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={expandAspectRatio === 'free' || isProcessing || naturalSize.w <= 0}
              onClick={() => {
                const preset = EXPAND_ASPECT_PRESETS.find(
                  (candidate) => candidate.id === expandAspectRatio,
                );
                if (!preset?.ratio || naturalSize.w <= 0 || naturalSize.h <= 0) return;
                try {
                  const padding = expandPaddingForAspectRatio(
                    naturalSize.w,
                    naturalSize.h,
                    preset.ratio,
                    expandAnchor,
                  );
                  setExpandPadding(padding);
                  setExpandTargetWidth(String(naturalSize.w + padding.left + padding.right));
                  setExpandTargetHeight(String(naturalSize.h + padding.top + padding.bottom));
                  invalidatePreview();
                } catch (error) {
                  setErrorMessage(
                    error instanceof Error ? error.message : 'The aspect ratio is invalid.',
                  );
                }
              }}
            >
              Set ratio
            </Button>
          </div>
          <div className="caf-dialog__expand-target">
            <label className="caf-dialog__expand-control" htmlFor="caf-expand-width">
              <span>Output width</span>
              <input
                id="caf-expand-width"
                type="number"
                min={naturalSize.w || 1}
                max={8192}
                step={1}
                value={expandTargetWidth}
                placeholder={naturalSize.w ? String(naturalSize.w) : 'Source width'}
                onChange={(event) => setExpandTargetWidth(event.target.value)}
                disabled={isProcessing}
              />
            </label>
            <label className="caf-dialog__expand-control" htmlFor="caf-expand-height">
              <span>Output height</span>
              <input
                id="caf-expand-height"
                type="number"
                min={naturalSize.h || 1}
                max={8192}
                step={1}
                value={expandTargetHeight}
                placeholder={naturalSize.h ? String(naturalSize.h) : 'Source height'}
                onChange={(event) => setExpandTargetHeight(event.target.value)}
                disabled={isProcessing}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={
                isProcessing ||
                naturalSize.w <= 0 ||
                naturalSize.h <= 0 ||
                !expandTargetWidth ||
                !expandTargetHeight
              }
              onClick={() => {
                const outputWidth = Number(expandTargetWidth);
                const outputHeight = Number(expandTargetHeight);
                try {
                  const padding = expandPaddingForOutputSize(
                    naturalSize.w,
                    naturalSize.h,
                    outputWidth,
                    outputHeight,
                    expandAnchor,
                  );
                  setExpandPadding(padding);
                  setExpandAspectRatio('free');
                  invalidatePreview();
                } catch (error) {
                  setErrorMessage(
                    error instanceof Error ? error.message : 'The output frame is invalid.',
                  );
                }
              }}
            >
              Set size
            </Button>
          </div>
          <div className="caf-dialog__expand-grid">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} className="caf-dialog__expand-field">
                <span>{side}</span>
                <input
                  id={`caf-expand-${side}`}
                  type="number"
                  min={0}
                  max={4096}
                  step={1}
                  value={expandPadding[side]}
                  onChange={(event) => {
                    const value = Math.max(0, Math.min(4096, Number(event.target.value) || 0));
                    const nextPadding = { ...expandPadding, [side]: value };
                    setExpandPadding(nextPadding);
                    setExpandAspectRatio('free');
                    if (naturalSize.w > 0 && naturalSize.h > 0) {
                      setExpandTargetWidth(
                        String(naturalSize.w + nextPadding.left + nextPadding.right),
                      );
                      setExpandTargetHeight(
                        String(naturalSize.h + nextPadding.top + nextPadding.bottom),
                      );
                    }
                    invalidatePreview();
                  }}
                  disabled={isProcessing}
                />
              </label>
            ))}
          </div>
          <p className="caf-dialog__hint">
            Expansion generates only the new bounds; existing pixels are copied unchanged.
          </p>
          {expandPlanPreview && !expandPlanPreview.ok && (
            <p className="caf-dialog__error" role="status">
              {expandPlanPreview.error.message}
            </p>
          )}
          {expandPlanPreview?.ok && !expandPlanPreview.plan.isNoop && (
            <p className="caf-dialog__hint">
              Output {expandPlanPreview.plan.outputWidth} x {expandPlanPreview.plan.outputHeight}{' '}
              px. {estimateExpandGenerationResolution(expandPlanPreview.plan, 512).disclosure}
            </p>
          )}
        </div>
      )}
    </>
  );
}
