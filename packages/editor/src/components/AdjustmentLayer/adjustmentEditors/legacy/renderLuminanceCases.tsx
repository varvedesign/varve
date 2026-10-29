import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import { ColorBalanceAdjustmentEditor } from '../../ColorBalanceAdjustmentEditor';
import { SplitToneEditor, WhiteBalanceEditor } from '../../TonalColorEditors';
import { CurvesEditor } from '../curves';
import { LevelsEditor } from '../levels';
import { SelectiveColorEditor } from '../selectiveColor';
import type { LegacyEditorContext } from './useLegacyEditorContext';

export function renderLuminanceCases(context: LegacyEditorContext) {
  const {
    adjustment,
    onChange,
    onEditStart,
    onEditEnd,
    sourceHistogram,
    histogramSourceLabel,
    histogramLoading,
    sourceImageData,
    handleValue,
    handleNumber,
  } = context;

  switch (adjustment.kind) {
    case 'whiteBalance':
      return (
        <WhiteBalanceEditor
          adjustment={adjustment}
          onChange={onChange}
          sourceImageData={sourceImageData}
          histogramSourceLabel={histogramSourceLabel}
        />
      );
    case 'splitTone':
      return <SplitToneEditor adjustment={adjustment} onChange={onChange} />;
    case 'brightness':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Brightness</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Brightness"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'contrast':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Contrast</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Contrast"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'levels':
      return (
        <LevelsEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
          histogramSourceLabel={histogramSourceLabel}
          histogramLoading={histogramLoading}
        />
      );

    case 'curves':
      return (
        <CurvesEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
          sourceImageData={sourceImageData}
          histogramSourceLabel={histogramSourceLabel}
          histogramLoading={histogramLoading}
        />
      );

    case 'selectiveColor':
      return (
        <SelectiveColorEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'colorBalance':
      return (
        <ColorBalanceAdjustmentEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'exposure':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>EV</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Exposure"
            min={-10}
            max={10}
            step={0.1}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
          <div className="adj-editor__row">
            <span className="adj-editor__label">Offset</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.offset}
              onChange={handleNumber('offset')}
              step={0.01}
              aria-label="Offset"
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Gamma</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.gammaCorrection}
              onChange={handleNumber('gammaCorrection')}
              step={0.01}
              min={0.01}
              max={10}
              aria-label="Gamma correction"
            />
          </div>
        </div>
      );

    case 'temperature':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Temperature</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Temperature"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );

    case 'saturation':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Saturation</span>
            <span>{adjustment.value}</span>
          </div>
          <RangeValueControl
            label="Saturation"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleValue('value')}
          />
        </div>
      );
  }
  return undefined;
}
