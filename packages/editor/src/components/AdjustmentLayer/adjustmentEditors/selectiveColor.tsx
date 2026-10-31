import type { Adjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import { BooleanRow } from './controls';
import type { AdjustmentEditorProps } from './types';

export function SelectiveColorEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').SelectiveColorAdjustment;
  const handleValue = (key: string) => (value: number) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Color Range</span>
        <Select
          label="Color range"
          value={adj.colorRange}
          options={[
            { value: 'reds', label: 'Reds' },
            { value: 'yellows', label: 'Yellows' },
            { value: 'greens', label: 'Greens' },
            { value: 'cyans', label: 'Cyans' },
            { value: 'blues', label: 'Blues' },
            { value: 'magentas', label: 'Magentas' },
            { value: 'whites', label: 'Whites' },
            { value: 'neutrals', label: 'Neutrals' },
            { value: 'blacks', label: 'Blacks' },
          ]}
          onChange={handleSelect('colorRange')}
        />
      </div>
      <BooleanRow
        label="Relative"
        checked={adj.relative}
        onChange={(value) => onChange({ relative: value } as unknown as Partial<Adjustment>)}
        ariaLabel="Relative adjustment"
      />
      {(['cyan', 'magenta', 'yellow', 'black'] as const).map((channel) => (
        <div key={channel} className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>{channel.charAt(0).toUpperCase() + channel.slice(1)}</span>
            <span>{adj[channel]}</span>
          </div>
          <RangeValueControl
            label={channel}
            min={-100}
            max={100}
            value={adj[channel]}
            onChange={handleValue(channel)}
          />
        </div>
      ))}
    </div>
  );
}
