import { mixerRows } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { NumberField } from '../../Inspector/controls/NumberField';
import { BooleanRow } from './controls';
import type { AdjustmentEditorProps } from './types';

export function ChannelMixerEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').ChannelMixerAdjustment;
  const rows = mixerRows(adj),
    active = adj.monochrome ? 'red' : adj.outputChannel,
    row = rows[active];
  const patchRow = (key: keyof typeof row, value: number) => {
    const updated = { ...row, [key]: value };
    onChange({ ...updated, rows: { ...rows, [active]: updated } } as Partial<Adjustment>);
  };
  return (
    <div className="curve-editor">
      <Select
        label="Output channel"
        value={active}
        disabled={adj.monochrome}
        options={[
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
          { value: 'blue', label: 'Blue' },
        ]}
        onChange={(v) => {
          const channel = v as 'red' | 'green' | 'blue';
          onChange({ outputChannel: channel, ...rows[channel], rows } as Partial<Adjustment>);
        }}
      />
      <BooleanRow
        label="Monochrome"
        checked={adj.monochrome}
        onChange={(monochrome) => onChange({ monochrome, rows } as Partial<Adjustment>)}
      />
      <NumberField
        label="Red percent"
        displayLabel="Red %"
        value={row.redPercent}
        onChange={(v) => patchRow('redPercent', v)}
        step={1}
      />
      <NumberField
        label="Green percent"
        displayLabel="Green %"
        value={row.greenPercent}
        onChange={(v) => patchRow('greenPercent', v)}
        step={1}
      />
      <NumberField
        label="Blue percent"
        displayLabel="Blue %"
        value={row.bluePercent}
        onChange={(v) => patchRow('bluePercent', v)}
        step={1}
      />
      <NumberField
        label="Constant (code values)"
        displayLabel="Offset"
        value={row.constant}
        onChange={(v) => patchRow('constant', v)}
        step={1}
      />
      <span className="curve-editor__hint">
        Every output reads the original RGB. Coefficients are not normalized. Monochrome uses the
        Red row.
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange({
            rows: undefined,
            outputChannel: 'red',
            redPercent: 100,
            greenPercent: 0,
            bluePercent: 0,
            constant: 0,
            monochrome: false,
          } as Partial<Adjustment>)
        }
      >
        Reset mixer
      </Button>
    </div>
  );
}
