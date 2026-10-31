import { autoContrastParams } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { HistogramWidget } from '../../Inspector/controls/HistogramWidget';
import type { AdjustmentEditorProps } from './types';

// LevelsAdjustment (document model: inputShadows/inputMidtones/inputHighlights/
// outputShadows/outputHighlights) and HistogramWidget's LevelParams (inputBlack/
// gamma/inputWhite/outputBlack/outputWhite) are the same five concepts under
// different names — no unit/space conversion, just a field-rename adapter.
function levelsAdjustmentToParams(
  adj: import('@varve/scene').LevelsAdjustment,
): import('@varve/engine').LevelParams {
  return {
    inputBlack: adj.inputShadows,
    gamma: adj.inputMidtones,
    inputWhite: adj.inputHighlights,
    outputBlack: adj.outputShadows,
    outputWhite: adj.outputHighlights,
  };
}
function paramsToLevelsAdjustmentPatch(
  params: import('@varve/engine').LevelParams,
): Partial<import('@varve/scene').LevelsAdjustment> {
  return {
    inputShadows: params.inputBlack,
    inputMidtones: params.gamma,
    inputHighlights: params.inputWhite,
    outputShadows: params.outputBlack,
    outputHighlights: params.outputWhite,
  };
}
export function LevelsEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  sourceHistogram,
  histogramSourceLabel,
  histogramLoading,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').LevelsAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const histogramChannel = adj.channel === 'rgb' ? 'luminance' : adj.channel;
  const handleAutoContrast = () => {
    if (!sourceHistogram) return;
    onEditStart?.();
    const auto = autoContrastParams(sourceHistogram);
    onChange({ inputShadows: auto.inputBlack, inputHighlights: auto.inputWhite });
    onEditEnd?.();
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <Select
          label="Channel"
          value={adj.channel}
          options={[
            { value: 'rgb', label: 'RGB' },
            { value: 'red', label: 'Red' },
            { value: 'green', label: 'Green' },
            { value: 'blue', label: 'Blue' },
          ]}
          onChange={handleSelect('channel')}
        />
      </div>
      <HistogramWidget
        histogram={sourceHistogram ?? undefined}
        sourceLabel={histogramSourceLabel}
        loading={histogramLoading}
        levels={levelsAdjustmentToParams(adj)}
        onChange={(params) => onChange(paramsToLevelsAdjustmentPatch(params))}
        channel={histogramChannel}
        onChannelChange={(channel) =>
          handleSelect('channel')(channel === 'luminance' ? 'rgb' : channel)
        }
        onDragStart={onEditStart}
        onDragEnd={onEditEnd}
      />
      <button
        type="button"
        className="insp-add-btn"
        onClick={handleAutoContrast}
        disabled={!sourceHistogram}
        aria-label="Auto Contrast"
      >
        Auto Contrast
      </button>
    </div>
  );
}
