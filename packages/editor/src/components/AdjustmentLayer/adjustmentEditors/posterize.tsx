import type { Adjustment } from '@varve/scene';
import { RangeValueControl } from '../../Inspector/controls/RangeValueControl';
import type { AdjustmentEditorProps } from './types';

export function PosterizeEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').PosterizeAdjustment;
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>Levels</span>
        <span>{adj.levels}</span>
      </div>
      <RangeValueControl
        label="Posterize levels"
        min={2}
        max={256}
        value={adj.levels}
        onChange={(value) => onChange({ levels: value } as unknown as Partial<Adjustment>)}
      />
    </div>
  );
}
