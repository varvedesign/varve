import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import type { EffectDiagnostic, EffectMaskResolver, ReplayColorOptions } from './types';

/** Resolve an image source URL to a decoded canvas source for the active replay. */
export type ReplayImageLookup = (src: string) => CanvasImageSource | undefined;

/** Recursive replay entry point, wired by replay.ts to avoid a module cycle. */
export type NestedReplay = (
  target: ReplayTarget,
  ir: readonly RenderItem[],
  imageLookup?: ReplayImageLookup,
  effectMaskResolver?: EffectMaskResolver,
  imagePolicy?: unknown,
  colorOptions?: ReplayColorOptions,
) => void;

/**
 * Per-replay mutable state. After the god-file splits, paint modules live in
 * separate files, so the current lookup/policy/resolver/sink cannot live in the
 * orchestrator: importing it from a moved module would create a dependency
 * cycle. The four declarations keep their pre-split names and live here so the
 * C-01 declaration-preservation proof still sees them after the move.
 * replay.ts owns all writes through `replayRuntime` and restores the previous
 * values in its finally block.
 */
export let imageLookupForCurrentReplay: ReplayImageLookup | null = null;
export let effectMaskResolverForCurrentReplay: EffectMaskResolver | null = null;
export let imagePolicyForCurrentReplay: unknown;
export let effectDiagnosticSinkForCurrentReplay: ((diagnostic: EffectDiagnostic) => void) | null =
  null;

/** Grouped accessors over the live bindings above, used by replay.ts. */
export const replayRuntime = {
  get imageLookup(): ReplayImageLookup | null {
    return imageLookupForCurrentReplay;
  },
  set imageLookup(value: ReplayImageLookup | null) {
    imageLookupForCurrentReplay = value;
  },
  get effectMaskResolver(): EffectMaskResolver | null {
    return effectMaskResolverForCurrentReplay;
  },
  set effectMaskResolver(value: EffectMaskResolver | null) {
    effectMaskResolverForCurrentReplay = value;
  },
  get imagePolicy(): unknown {
    return imagePolicyForCurrentReplay;
  },
  set imagePolicy(value: unknown) {
    imagePolicyForCurrentReplay = value;
  },
  get diagnosticSink(): ((diagnostic: EffectDiagnostic) => void) | null {
    return effectDiagnosticSinkForCurrentReplay;
  },
  set diagnosticSink(value: ((diagnostic: EffectDiagnostic) => void) | null) {
    effectDiagnosticSinkForCurrentReplay = value;
  },
  nestedReplay: null as NestedReplay | null,
};
