import type { Adjustment } from '@varve/scene';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import { BooleanRow } from './controls';
import { colorToManaged, managedToColor } from './managedColor';
import type { AdjustmentEditorProps } from './types';

export function PhotoFilterEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').PhotoFilterAdjustment;
  const handleValue = (key: string) => (value: number) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Density</span>
        <RangeValueControl
          label="Density"
          min={0}
          max={100}
          value={adj.density}
          unit="%"
          onChange={handleValue('density')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Filter Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.color)}
        onChange={(color) =>
          onChange({ color: managedToColor(color) } as unknown as Partial<Adjustment>)
        }
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <BooleanRow
        label="Preserve Luminosity"
        checked={adj.preserveLuminosity}
        onChange={(value) =>
          onChange({ preserveLuminosity: value } as unknown as Partial<Adjustment>)
        }
      />
    </div>
  );
}
