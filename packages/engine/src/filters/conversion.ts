import type { FilterIR } from '../types';
import type { Adjustment } from './adjustment';
import { creativeAdjustmentToFilter } from './conversionCreative';
import { effectsAdjustmentToFilter } from './conversionEffects';
import { toneAdjustmentToFilter } from './conversionTone';
import { treatmentAdjustmentToFilter } from './conversionTreatment';
import { isKnownAdjustmentKind } from './types';

export function adjustmentToFilter(adjustment: Adjustment): FilterIR {
  const base = { opacity: adjustment.opacity, blendMode: adjustment.blendMode };
  return (
    toneAdjustmentToFilter(adjustment, base) ??
    creativeAdjustmentToFilter(adjustment, base) ??
    effectsAdjustmentToFilter(adjustment, base) ??
    treatmentAdjustmentToFilter(adjustment, base) ?? {
      kind: 'opacity',
      value: 100,
      opacity: 1,
      blendMode: 'normal',
    }
  );
}

export function adjustmentsToFilters(adjustments: readonly Adjustment[]): FilterIR[] {
  return adjustments
    .filter((a) => a.visible !== false && (a.opacity ?? 1) > 0 && isKnownAdjustmentKind(a.kind))
    .map(adjustmentToFilter);
}
