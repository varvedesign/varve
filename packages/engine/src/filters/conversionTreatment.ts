import type { FilterIR } from '../types';
import type { Adjustment } from './adjustment';

export function treatmentAdjustmentToFilter(
  adjustment: Adjustment,
  base: Pick<Adjustment, 'opacity' | 'blendMode'>,
): FilterIR | undefined {
  switch (adjustment.kind) {
    case 'shadowHighlight':
      return {
        kind: 'shadowHighlight',
        shadows: adjustment.shadows,
        highlights: adjustment.highlights,
        tonalWidth: adjustment.tonalWidth,
        midpoint: adjustment.midpoint,
        ...base,
      };
    case 'microDetail':
      return {
        kind: 'microDetail',
        amount: adjustment.amount,
        threshold: adjustment.threshold,
        ...base,
      };
    case 'definition':
      return {
        kind: 'definition',
        amount: adjustment.amount,
        radius: adjustment.radius,
        protectHighlights: adjustment.protectHighlights,
        ...base,
      };
    case 'atmosphere':
      return {
        kind: 'atmosphere',
        amount: adjustment.amount,
        radius: adjustment.radius,
        protectHighlights: adjustment.protectHighlights,
        ...base,
      };
    case 'dehaze':
      return {
        kind: 'dehaze',
        amount: adjustment.amount,
        radius: adjustment.radius,
        protectHighlights: adjustment.protectHighlights,
        ...base,
      };
    case 'edgeFalloff':
      return {
        kind: 'edgeFalloff',
        strength: adjustment.strength,
        midpoint: adjustment.midpoint,
        feather: adjustment.feather,
        roundness: adjustment.roundness,
        centerX: adjustment.centerX,
        centerY: adjustment.centerY,
        highlightProtection: adjustment.highlightProtection,
        ...base,
      };
    case 'grain':
      return {
        kind: 'grain',
        strength: adjustment.strength,
        scale: adjustment.scale,
        character: adjustment.character,
        seed: adjustment.seed,
        ...base,
      };
    case 'softBloom':
      return {
        kind: 'softBloom',
        strength: adjustment.strength,
        radius: adjustment.radius,
        threshold: adjustment.threshold,
        softness: adjustment.softness,
        ...base,
      };
    default:
      return undefined;
  }
}
