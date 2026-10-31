import { COLOR_HALFTONE_PRESETS, type Color, DOC_PIXELS_PER_INCH } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useMemo } from 'react';
import { RangeValueControl } from '../../../Inspector/controls/RangeValueControl';
import { colorToManaged, managedToColor } from '../managedColor';
import type { AdjustmentEditorProps } from '../types';

export function ColorHalftoneEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/engine').ColorHalftoneAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const handleValue = (key: string) => (value: number) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  const currentPresetId = useMemo(() => {
    const match = COLOR_HALFTONE_PRESETS.find(
      (p) =>
        p.params.screenSize === adj.screenSize &&
        p.params.angle === adj.angle &&
        p.params.dotShape === adj.dotShape &&
        p.params.mode === adj.mode,
    );
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = COLOR_HALFTONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      onChange({
        screenSize: preset.params.screenSize,
        angle: preset.params.angle,
        dotShape: preset.params.dotShape,
        mode: preset.params.mode,
        algorithmVersion: 2,
        inkColor: preset.params.inkColor ? ([...preset.params.inkColor] as Color) : undefined,
      } as unknown as Partial<Adjustment>);
    }
  };

  const isLegacy = adj.algorithmVersion === 1;
  const periodPx = DOC_PIXELS_PER_INCH / Math.max(1, adj.screenSize);

  return (
    <div>
      {isLegacy && (
        <>
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
          <p className="adj-editor__hint">
            This effect used a screen whose tone was inverted and whose mix double-counted black.
            Updating keeps its settings and corrects the output.
          </p>
        </>
      )}
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Color halftone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={COLOR_HALFTONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Mode</span>
        <Select
          label="Channel mode"
          value={adj.mode}
          options={[
            { value: 'cmyk', label: 'CMYK' },
            { value: 'rgb', label: 'RGB' },
            { value: 'mono', label: 'Mono' },
          ]}
          onChange={handleSelect('mode')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Dot Shape</span>
        <Select
          label="Dot shape"
          value={adj.dotShape}
          options={[
            { value: 'round', label: 'Round' },
            { value: 'square', label: 'Square' },
            { value: 'diamond', label: 'Diamond' },
            { value: 'line', label: 'Line' },
          ]}
          onChange={handleSelect('dotShape')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Screen Size</span>
          <span>{adj.screenSize} LPI</span>
        </div>
        <RangeValueControl
          label="Screen size"
          min={3}
          max={60}
          step={1}
          value={adj.screenSize}
          unit="LPI"
          onChange={handleValue('screenSize')}
        />
        <p className="adj-editor__hint">
          Period {periodPx.toFixed(2)} px at 96 ppi.
          {adj.mode === 'cmyk'
            ? ' CMYK is an uncalibrated artistic separation, not an ICC process proof.'
            : adj.mode === 'mono'
              ? ' Mono screens ink over the source colours.'
              : ''}
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
          max={359}
          step={1}
          value={adj.angle}
          unit="°"
          onChange={handleValue('angle')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round(adj.intensity * 100)}%</span>
        </div>
        <RangeValueControl
          label="Color halftone intensity"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.intensity * 100)}
          unit="%"
          onChange={(value) =>
            onChange({ intensity: value / 100 } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      {adj.mode === 'mono' && (
        <>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Ink Color</span>
          </div>
          <ColorPicker
            value={colorToManaged(adj.inkColor ?? [0, 0, 0, 255])}
            onChange={(c) =>
              onChange({ inkColor: managedToColor(c) } as unknown as Partial<Adjustment>)
            }
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
        </>
      )}
    </div>
  );
}
