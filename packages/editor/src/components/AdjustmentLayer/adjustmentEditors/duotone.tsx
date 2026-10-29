import type { Adjustment, ManagedColor } from '@varve/scene';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import { BooleanRow } from './controls';
import { managedToColor } from './managedColor';
import type { AdjustmentEditorProps } from './types';

export function DuotoneEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').DuotoneAdjustment;
  const handleColor = (key: 'shadowColor' | 'highlightColor') => (c: ManagedColor) => {
    onChange({ [key]: managedToColor(c) } as unknown as Partial<Adjustment>);
  };

  return (
    <div className="adj-editor__group">
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadow Point</span>
          <span>{adj.shadowPoint.toFixed(2)}</span>
        </div>
        <RangeValueControl
          label="Shadow point"
          min={0}
          max={1}
          step={0.01}
          value={adj.shadowPoint}
          onChange={(value) => onChange({ shadowPoint: value } as unknown as Partial<Adjustment>)}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlight Point</span>
          <span>{adj.highlightPoint.toFixed(2)}</span>
        </div>
        <RangeValueControl
          label="Highlight point"
          min={0}
          max={1}
          step={0.01}
          value={adj.highlightPoint}
          onChange={(value) =>
            onChange({ highlightPoint: value } as unknown as Partial<Adjustment>)
          }
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{adj.intensity.toFixed(2)}</span>
        </div>
        <RangeValueControl
          label="Intensity"
          min={0}
          max={1}
          step={0.01}
          value={adj.intensity}
          onChange={(value) => onChange({ intensity: value } as unknown as Partial<Adjustment>)}
        />
      </div>
      <div className="adj-editor__color-row">
        <span className="adj-editor__label">Shadow Color</span>
        <ColorPicker
          value={
            {
              space: 'rgb',
              r: adj.shadowColor[0],
              g: adj.shadowColor[1],
              b: adj.shadowColor[2],
              a: adj.shadowColor[3] ?? 255,
            } as ManagedColor
          }
          onChange={handleColor('shadowColor')}
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
        />
      </div>
      <div className="adj-editor__color-row">
        <span className="adj-editor__label">Highlight Color</span>
        <ColorPicker
          value={
            {
              space: 'rgb',
              r: adj.highlightColor[0],
              g: adj.highlightColor[1],
              b: adj.highlightColor[2],
              a: adj.highlightColor[3] ?? 255,
            } as ManagedColor
          }
          onChange={handleColor('highlightColor')}
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
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
          label="Duotone interpolation"
          value={adj.interpolation ?? 'smoothstep'}
          options={[
            { value: 'smoothstep', label: 'Smooth' },
            { value: 'linear', label: 'Linear' },
          ]}
          onChange={(value) =>
            onChange({
              interpolation: value as 'smoothstep' | 'linear',
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
    </div>
  );
}
