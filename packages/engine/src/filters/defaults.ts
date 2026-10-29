import type { Adjustment } from './adjustment';
import { creativeDefaults } from './defaultsCreative';
import { effectsDefaults } from './defaultsEffects';
import { toneDefaults } from './defaultsTone';
import { treatmentDefaults } from './defaultsTreatment';
import type { AdjustmentBlendMode, AdjustmentKind } from './types';

export function adjustmentDefaults(kind: AdjustmentKind): Omit<Adjustment, 'id' | 'kind'> {
  const base = { visible: true, opacity: 1, blendMode: 'normal' as AdjustmentBlendMode };
  return (
    toneDefaults(kind, base) ??
    creativeDefaults(kind, base) ??
    effectsDefaults(kind, base) ??
    treatmentDefaults(kind, base) ??
    ({ ...base } as Omit<Adjustment, 'id' | 'kind'>)
  );
}

export function makeAdjustment(
  id: string,
  kind: AdjustmentKind,
  overrides: Partial<Adjustment> = {},
): Adjustment {
  const defaults = adjustmentDefaults(kind);
  return { id, kind, ...defaults, ...overrides } as Adjustment;
}
