import type { Color } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import { BooleanRow } from './controls';
import { colorToManaged, managedToColor } from './managedColor';
import type { AdjustmentEditorProps } from './types';

export function BlackAndWhiteEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').BlackAndWhiteAdjustment;
  const channels: { key: keyof import('@varve/scene').BlackAndWhiteAdjustment; label: string }[] = [
    { key: 'reds', label: 'Reds' },
    { key: 'yellows', label: 'Yellows' },
    { key: 'greens', label: 'Greens' },
    { key: 'cyans', label: 'Cyans' },
    { key: 'blues', label: 'Blues' },
    { key: 'magentas', label: 'Magentas' },
  ];

  return (
    <div className="adj-editor__group">
      {channels.map((ch) => (
        <div key={ch.key} className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>{ch.label}</span>
            <span>{adj[ch.key] as number}</span>
          </div>
          <RangeValueControl
            label={ch.label}
            min={-200}
            max={300}
            value={adj[ch.key] as number}
            onChange={(value) => onChange({ [ch.key]: value } as unknown as Partial<Adjustment>)}
          />
        </div>
      ))}
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Brightness</span>
          <span>{adj.brightness}</span>
        </div>
        <RangeValueControl
          label="Brightness"
          min={-100}
          max={100}
          value={adj.brightness}
          onChange={(value) => onChange({ brightness: value } as unknown as Partial<Adjustment>)}
        />
      </div>
      <BooleanRow
        label="Preserve Luminosity"
        checked={adj.preserveLuminosity}
        onChange={(value) =>
          onChange({ preserveLuminosity: value } as unknown as Partial<Adjustment>)
        }
      />
      <BooleanRow
        label="Tint"
        checked={adj.tintColor !== undefined}
        onChange={(value) =>
          onChange({
            tintColor: value ? ([190, 170, 140, 255] as Color) : undefined,
          } as unknown as Partial<Adjustment>)
        }
      />
      {adj.tintColor && (
        <ColorPicker
          value={colorToManaged(adj.tintColor)}
          onChange={(color) =>
            onChange({ tintColor: managedToColor(color) } as unknown as Partial<Adjustment>)
          }
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
        />
      )}
    </div>
  );
}
