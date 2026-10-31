import { HALFTONE_PRESETS } from '@varve/engine';
import { type Adjustment, type ManagedColor, rgbFromTuple } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import { BooleanRow } from '../controls';
import type { AdjustmentEditorProps } from '../types';
import { HalftoneAdvancedPhase } from './HalftoneAdvancedPhase';
import { HALFTONE_SHAPE_OPTIONS } from './options';
import { useHalftoneModel } from './useHalftoneModel';

export function HalftoneEditor(props: AdjustmentEditorProps) {
  const model = useHalftoneModel(props);
  const {
    onChange,
    adj,
    handleSelect,
    handleValue,
    method,
    isCmyk,
    isLegacy,
    periodPx,
    currentPresetId,
    handlePresetSelect,
    handleShapeChange,
    fgColor,
    bgColor,
    isMonoChannel,
  } = model;

  return (
    <div>
      {isLegacy && (
        <div className="adj-editor__row">
          <span className="adj-editor__label">Legacy screen</span>
          <button
            type="button"
            className="adj-editor__action"
            onClick={() => onChange({ algorithmVersion: 2 } as unknown as Partial<Adjustment>)}
          >
            Update to corrected screening
          </button>
        </div>
      )}
      {isLegacy && (
        <p className="adj-editor__hint">
          This effect was created before the corrected screen contract. Updating keeps its settings
          but renders the requested ruling and dot shape accurately.
        </p>
      )}
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Halftone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={HALFTONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Method</span>
        <Select
          label="Screening method"
          value={method}
          options={[
            { value: 'am', label: 'AM (clustered dot)' },
            { value: 'fm', label: 'FM (stochastic)' },
          ]}
          onChange={handleSelect('method')}
        />
      </div>
      {method === 'fm' && (
        <div className="adj-editor__row">
          <span className="adj-editor__label">Dither</span>
          <Select
            label="FM dither algorithm"
            value={adj.fmAlgorithm ?? 'blue-noise'}
            options={[
              { value: 'blue-noise', label: 'Blue noise (stochastic)' },
              { value: 'bayer', label: 'Bayer ordered' },
              { value: 'error-diffusion', label: 'Error diffusion (export)' },
            ]}
            onChange={handleSelect('fmAlgorithm')}
          />
        </div>
      )}
      {method === 'fm' && (adj.fmAlgorithm ?? 'blue-noise') === 'error-diffusion' && (
        <p className="adj-editor__hint">
          Error diffusion is a full-frame algorithm. Newly created effects keep preview and export
          identical; legacy documents that selected it show the blue-noise preview while exporting
          with error diffusion.
        </p>
      )}
      {method === 'am' && (
        <div className="adj-editor__row">
          <span className="adj-editor__label">Shape</span>
          <Select
            label="Dot shape"
            value={adj.dotShape}
            options={HALFTONE_SHAPE_OPTIONS}
            onChange={handleShapeChange}
          />
        </div>
      )}
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <Select
          label="Ink channel"
          value={adj.channel}
          options={[
            { value: 'k', label: 'Black (K)' },
            { value: 'c', label: 'Cyan (C)' },
            { value: 'm', label: 'Magenta (M)' },
            { value: 'y', label: 'Yellow (Y)' },
            { value: 'cmyk', label: 'CMYK (all channels)' },
          ]}
          onChange={handleSelect('channel')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Frequency (LPI)</span>
          <span>{adj.frequency}</span>
        </div>
        <RangeValueControl
          label="Screen frequency"
          min={5}
          max={150}
          step={1}
          value={adj.frequency}
          unit="LPI"
          rangeAriaLabel="Screen frequency in lines per inch"
          onChange={handleValue('frequency')}
        />
        <p className="adj-editor__hint">
          Period {periodPx.toFixed(2)} px at 96 ppi
          {periodPx < 3 ? ' — increase export resolution to resolve this ruling.' : '.'}
        </p>
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Angle</span>
          <span>{adj.angle}°</span>
        </div>
        <RangeValueControl
          label="Screen angle"
          min={0}
          max={179}
          step={1}
          value={adj.angle}
          unit="°"
          rangeAriaLabel="Screen angle in degrees"
          onChange={handleValue('angle')}
          disabled={isCmyk}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Threshold</span>
          <span>{adj.threshold ?? 128}</span>
        </div>
        <RangeValueControl
          label="Halftone threshold"
          min={0}
          max={255}
          step={1}
          value={adj.threshold ?? 128}
          onChange={handleValue('threshold')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round((adj.intensity ?? 1) * 100)}%</span>
        </div>
        <RangeValueControl
          label="Halftone intensity"
          min={0}
          max={100}
          step={1}
          value={Math.round((adj.intensity ?? 1) * 100)}
          unit="%"
          onChange={(value) =>
            onChange({ intensity: value / 100 } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Softness</span>
          <span>{Math.round((adj.softness ?? 0) * 100)}%</span>
        </div>
        <RangeValueControl
          label="Dot edge softness"
          min={0}
          max={100}
          step={1}
          value={Math.round((adj.softness ?? 0) * 100)}
          unit="%"
          onChange={(value) =>
            onChange({ softness: value / 100 } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      <BooleanRow
        label="Invert"
        checked={adj.invert ?? false}
        onChange={(value) => onChange({ invert: value } as unknown as Partial<Adjustment>)}
        ariaLabel="Invert halftone output"
      />
      {isMonoChannel && (
        <>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Ink Color</span>
            <ColorPicker
              value={rgbFromTuple([fgColor[0], fgColor[1], fgColor[2], 255])}
              onChange={(c: ManagedColor) => {
                const rgb = managedColorToRgba(c);
                onChange({
                  foregroundColor: [rgb[0], rgb[1], rgb[2]],
                } as unknown as Partial<Adjustment>);
              }}
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Paper Color</span>
            <ColorPicker
              value={rgbFromTuple([bgColor[0], bgColor[1], bgColor[2], 255])}
              onChange={(c: ManagedColor) => {
                const rgb = managedColorToRgba(c);
                onChange({
                  backgroundColor: [rgb[0], rgb[1], rgb[2]],
                } as unknown as Partial<Adjustment>);
              }}
            />
          </div>
        </>
      )}
      {isMonoChannel && method === 'am' && (
        <div className="adj-editor__row">
          <span className="adj-editor__label">Alpha</span>
          <Select
            label="Alpha handling"
            value={adj.alphaMode ?? 'preserve'}
            options={[
              { value: 'preserve', label: 'Preserve source alpha' },
              { value: 'screen', label: 'Screen ink into alpha' },
            ]}
            onChange={handleSelect('alphaMode')}
          />
        </div>
      )}
      <HalftoneAdvancedPhase model={model} />
    </div>
  );
}
