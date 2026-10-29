import { imageTreatmentDefaults } from '../imageTreatments';
import type { Adjustment } from './adjustment';
import type { AdjustmentKind } from './types';

export function treatmentDefaults(
  kind: AdjustmentKind,
  base: Pick<Adjustment, 'visible' | 'opacity' | 'blendMode'>,
): Omit<Adjustment, 'id' | 'kind'> | undefined {
  switch (kind) {
    case 'shadowHighlight':
      return {
        ...base,
        shadows: 0,
        highlights: 0,
        tonalWidth: 50,
        midpoint: 50,
      } as Omit<Adjustment, 'id' | 'kind'>;
    case 'microDetail':
    case 'definition':
    case 'atmosphere':
    case 'dehaze':
    case 'edgeFalloff':
    case 'grain':
    case 'softBloom':
      return { ...base, ...imageTreatmentDefaults(kind) } as Omit<Adjustment, 'id' | 'kind'>;
    default:
      return undefined;
  }
}
