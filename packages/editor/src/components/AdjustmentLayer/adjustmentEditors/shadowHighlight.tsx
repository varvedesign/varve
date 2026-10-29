import type { Adjustment } from '@varve/scene';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import type { AdjustmentEditorProps } from './types';

export function ShadowHighlightEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/engine').ShadowHighlightAdjustment;
  const handleValue = (key: string) => (value: number) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadows</span>
          <span>{adj.shadows}</span>
        </div>
        <RangeValueControl
          label="Shadow brightening"
          min={0}
          max={100}
          value={adj.shadows}
          unit="%"
          onChange={handleValue('shadows')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlights</span>
          <span>{adj.highlights}</span>
        </div>
        <RangeValueControl
          label="Highlight recovery"
          min={0}
          max={100}
          value={adj.highlights}
          unit="%"
          onChange={handleValue('highlights')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Tonal Width</span>
          <span>{adj.tonalWidth}</span>
        </div>
        <RangeValueControl
          label="Tonal width"
          min={0}
          max={100}
          value={adj.tonalWidth}
          unit="%"
          onChange={handleValue('tonalWidth')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Midpoint</span>
          <span>{adj.midpoint}</span>
        </div>
        <RangeValueControl
          label="Midpoint"
          min={0}
          max={100}
          value={adj.midpoint}
          unit="%"
          onChange={handleValue('midpoint')}
        />
      </div>
    </div>
  );
}
