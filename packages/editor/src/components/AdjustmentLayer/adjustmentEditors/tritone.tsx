import { type Color, TRITONE_PRESETS } from '@varve/engine';
import type { Adjustment, ManagedColor } from '@varve/scene';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useMemo } from 'react';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import { BooleanRow } from './controls';
import { colorToManaged, managedToColor } from './managedColor';
import type { AdjustmentEditorProps } from './types';

export function TritoneEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').TritoneAdjustment;
  const handleColor =
    (key: 'shadowColor' | 'midtoneColor' | 'highlightColor') => (c: ManagedColor) => {
      onChange({ [key]: managedToColor(c) } as unknown as Partial<Adjustment>);
    };

  const currentPresetId = useMemo(() => {
    const match = TRITONE_PRESETS.find(
      (p) =>
        p.shadowColor[0] === adj.shadowColor[0] &&
        p.shadowColor[1] === adj.shadowColor[1] &&
        p.shadowColor[2] === adj.shadowColor[2] &&
        p.midtoneColor[0] === adj.midtoneColor[0] &&
        p.midtoneColor[1] === adj.midtoneColor[1] &&
        p.midtoneColor[2] === adj.midtoneColor[2] &&
        p.highlightColor[0] === adj.highlightColor[0] &&
        p.highlightColor[1] === adj.highlightColor[1] &&
        p.highlightColor[2] === adj.highlightColor[2] &&
        Math.abs(p.shadowPoint - adj.shadowPoint) < 0.01 &&
        Math.abs(p.highlightPoint - adj.highlightPoint) < 0.01,
    );
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = TRITONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      onChange({
        shadowColor: [...preset.shadowColor] as Color,
        midtoneColor: [...preset.midtoneColor] as Color,
        highlightColor: [...preset.highlightColor] as Color,
        shadowPoint: preset.shadowPoint,
        highlightPoint: preset.highlightPoint,
      } as unknown as Partial<Adjustment>);
    }
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Tritone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={TRITONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Shadow Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.shadowColor)}
        onChange={handleColor('shadowColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__row">
        <span className="adj-editor__label">Midtone Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.midtoneColor)}
        onChange={handleColor('midtoneColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__row">
        <span className="adj-editor__label">Highlight Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.highlightColor)}
        onChange={handleColor('highlightColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadow Point</span>
          <span>{Math.round(adj.shadowPoint * 100)}%</span>
        </div>
        <RangeValueControl
          label="Shadow point"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.shadowPoint * 100)}
          unit="%"
          onChange={(value) =>
            onChange({
              shadowPoint: value / 100,
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlight Point</span>
          <span>{Math.round(adj.highlightPoint * 100)}%</span>
        </div>
        <RangeValueControl
          label="Highlight point"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.highlightPoint * 100)}
          unit="%"
          onChange={(value) =>
            onChange({
              highlightPoint: value / 100,
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round(adj.intensity * 100)}%</span>
        </div>
        <RangeValueControl
          label="Tritone intensity"
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
      <BooleanRow
        label="Preserve Luminosity"
        checked={adj.preserveLuminosity}
        onChange={(value) =>
          onChange({ preserveLuminosity: value } as unknown as Partial<Adjustment>)
        }
      />
      <div className="adj-editor__row">
        <span className="adj-editor__label">Interpolation</span>
        <Select
          label="Interpolation method"
          value={adj.interpolation ?? 'smoothstep'}
          options={[
            { value: 'smoothstep', label: 'Smooth' },
            { value: 'linear', label: 'Linear' },
          ]}
          onChange={(v) =>
            onChange({
              interpolation: v as 'smoothstep' | 'linear',
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
    </div>
  );
}
