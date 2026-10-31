import type { RenderItem } from '../types';
import { replayRuntime } from './runtime';
import type { EffectDiagnosticCode } from './types';
/**
 * Report an effect that was skipped or degraded. These paths previously kept
 * unmodified content with no signal, so a missing mask, depth map, or
 * offscreen surface silently shipped as if it were final output.
 */
export function reportEffectDiagnostic(
  effect: { type: string; id?: string },
  code: EffectDiagnosticCode,
  reason: string,
): void {
  replayRuntime.diagnosticSink?.({
    code,
    effectType: effect.type,
    ...(effect.id ? { effectId: effect.id } : {}),
    reason,
  });
}

/** Effect types whose `mask` binding the content pass actually evaluates. */
const CONTENT_EFFECT_TYPES: ReadonlySet<string> = new Set([
  'layerBlur',
  'depthBlur',
  'gaussianBlur',
  'fieldBlur',
  'irisBlur',
  'tiltShiftBlur',
  'pathBlur',
  'spinBlur',
  'chromaticAberration',
  'glitch',
]);

/**
 * Appearance and backdrop effects ignore `effect.mask` in every renderer
 * today. Report an authored, visible mask so it is never mistaken for an
 * applied one (the Inspector already hides authoring for these types).
 */
export function reportUnsupportedEffectMasks(item: RenderItem): void {
  if (!replayRuntime.diagnosticSink || !item.effects) return;
  for (const effect of item.effects) {
    if (!effect.visible || !effect.mask || effect.mask.visible === false) continue;
    if (CONTENT_EFFECT_TYPES.has(effect.type)) continue;
    reportEffectDiagnostic(
      effect,
      'effect-mask-unsupported',
      'effect masks are only evaluated for content-stage effects',
    );
  }
}
