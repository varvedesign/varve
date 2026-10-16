/**
 * Real ICC soft-proof provider for the render path.
 *
 * ## What this replaces
 *
 * `@varve/shared`'s `proofTransform.ts` defines the proof *contract* — a
 * profile-keyed converter registry plus a bounded result cache — but registers
 * no converter. Before this module, `applyProofToRgba` therefore always
 * returned `{ kind: 'unavailable' }` in every runtime, and `SoftProofOverlay`
 * rendered an empty overlay div, so the soft-proof toggle changed nothing on
 * the canvas.
 *
 * This module supplies the missing provider: a real ICC proofing chain
 * (`device → proof → proof → display`, lcms2 `cmsCreateProofingTransform`)
 * built inside the Rust `varve-colour` engine and executed over WASM.
 *
 * ## Configuration reaches the transform
 *
 * `@varve/shared` identifies a converter by profile id alone, so a converter
 * registered for an id would otherwise have to ignore the rendering intent,
 * BPC and paper flags. Those flags are real inputs to the ICC chain, so the
 * provider re-registers whenever the effective parameters change. That keeps
 * the shared contract intact while making the configuration reach the
 * computation.
 *
 * ## Display target
 *
 * The proof chain's final step targets **sRGB**, which is the colour space the
 * canvas surface is tagged as. Varve does not currently drive a per-monitor
 * display profile through the OS/browser (see
 * `docs/audits/colour-capability-inventory-2026-10-15.md`), so assuming sRGB
 * here is an accurate description of the current surface rather than a
 * claim of full display management. When real display-profile control lands,
 * this is the single place that changes.
 */

import type { RenderItem } from '@varve/engine';
import type { ProofConfig } from '@varve/scene';
import {
  type ProofTransformConfig,
  registerProfileGamutChecker,
  registerProfileProofConverterNormalized,
} from '@varve/shared';
import { applyProofToIr } from './proofing';

interface ProofWasmModule {
  WasmProofEngine: new () => ProofWasmEngine;
  wasm_bundled_srgb_profile(): Uint8Array;
  wasm_bundled_cmyk_profile(): Uint8Array;
  wasm_profile_fingerprint(data: Uint8Array): string;
}

interface ProofWasmEngine {
  set_display_profile(name: string, data: Uint8Array): void;
  set_output_profile(name: string, data: Uint8Array): void;
  display_profile_fingerprint(): string;
  output_profile_fingerprint(): string;
  proof_pixel(
    r: number,
    g: number,
    b: number,
    renderingIntent: string,
    blackPointCompensation: boolean,
    simulatePaperColor: boolean,
  ): Float32Array;
  is_out_of_gamut(
    r: number,
    g: number,
    b: number,
    renderingIntent: string,
    blackPointCompensation: boolean,
    simulatePaperColor: boolean,
  ): boolean;
  total_area_coverage(): number;
  simulation_support(simulatePaperColor: boolean, simulateBlackInk: boolean): Uint8Array;
  cached_transform_count(): number;
  retained_profile_bytes(): number;
}

/** WASM module URL, matching the `wasm-build-colour` output name. */
const COLOUR_WASM_URL = '/wasm/varve_colour_bg.wasm';

/**
 * Bundled output profiles. The render engine ships exactly one real CMYK
 * output condition — ISO Coated v2 (FOGRA39), a Zlib-licensed profile with
 * genuine A2B/B2A tables. Other press conditions are *not* bundled, so a proof
 * setup naming one must be reported as unavailable rather than silently
 * proofed against FOGRA39.
 */
const BUNDLED_OUTPUT_PROFILES: Readonly<Record<string, string>> = {
  fogra39: 'ISO Coated v2 (FOGRA39)',
  'iso-coated-v2': 'ISO Coated v2 (FOGRA39)',
};

export interface ProofProviderStatus {
  /** True when an ICC proofing transform is registered and usable. */
  available: boolean;
  /** Why proofing is unavailable, when it is. */
  reason?: string;
  /** Resolved output-condition label, when available. */
  outputProfileName?: string;
  /** Fingerprint of the registered output profile (identity, not name). */
  outputProfileFingerprint?: string;
  /** Detected total-area-coverage limit of the output profile, in percent. */
  totalAreaCoverage?: number;
  /** Which requested simulations the engine actually honours. */
  simulationSupport?: {
    renderingIntent: boolean;
    blackPointCompensation: boolean;
    paperColor: boolean;
    blackInk: boolean;
  };
}

let modulePromise: Promise<ProofWasmModule | null> | null = null;
let engine: ProofWasmEngine | null = null;
let registeredConfigKey: string | null = null;
let registeredProfileId: string | null = null;
let lastStatus: ProofProviderStatus = { available: false, reason: 'not initialised' };

/** Load the colour WASM module once, resolving to null when unavailable. */
async function loadProofModule(): Promise<ProofWasmModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        // The wasm-pack web build is loaded from the served asset directory
        // rather than bundled, matching how the rest of the colour WASM is
        // consumed (`packages/engine/src/colour/colourLoader.ts`).
        const jsUrl = COLOUR_WASM_URL.replace('_bg.wasm', '.js');
        const jsResponse = await fetch(jsUrl);
        if (!jsResponse.ok) return null;
        const jsCode = await jsResponse.text();
        const blobUrl = URL.createObjectURL(new Blob([jsCode], { type: 'text/javascript' }));
        try {
          const loaded = (await import(/* @vite-ignore */ blobUrl)) as {
            default: (init: { module_or_path: Promise<ArrayBuffer> }) => Promise<ProofWasmModule>;
          };
          return await loaded.default({
            module_or_path: fetch(COLOUR_WASM_URL).then((r) => r.arrayBuffer()),
          });
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

/**
 * Proof a single colour through the registered output condition.
 *
 * Returns the proofed sRGB triple, or `null` when no proofing transform is
 * available — never the unchanged input, so a caller cannot mistake
 * "unavailable" for "proofed and identical".
 */
export function proofPixel(
  rgb: [number, number, number],
  config: ProofTransformConfig,
): [number, number, number, number] | null {
  if (!engine) return null;
  try {
    const out = engine.proof_pixel(
      rgb[0],
      rgb[1],
      rgb[2],
      config.renderingIntent,
      config.blackPointCompensation,
      config.simulatePaperColor,
    );
    // Alpha is not a colour channel and must not be routed through the ICC
    // transform; the caller keeps the source alpha.
    return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, 1];
  } catch {
    return null;
  }
}

/**
 * Real gamut status for a colour under the output condition.
 *
 * Returns `null` when no proofing pipeline is available, so callers can
 * distinguish "in gamut" from "unknown" instead of treating an unavailable
 * check as a passing one.
 */
export function proofIsOutOfGamut(
  rgb: [number, number, number],
  config: ProofTransformConfig,
): boolean | null {
  if (!engine) return null;
  try {
    return engine.is_out_of_gamut(
      rgb[0],
      rgb[1],
      rgb[2],
      config.renderingIntent,
      config.blackPointCompensation,
      config.simulatePaperColor,
    );
  } catch {
    return null;
  }
}

/** Current provider status, for diagnostics and honest UI labelling. */
export function proofProviderStatus(): ProofProviderStatus {
  return lastStatus;
}

/**
 * Whether this build can actually proof against the named condition.
 *
 * Synchronous, so a UI can disable an unavailable option immediately rather
 * than letting the user select it and discover later that nothing happened.
 * Only conditions with a genuinely bundled ICC profile return `true`.
 */
export function isProofConditionAvailable(profileId: string): boolean {
  return BUNDLED_OUTPUT_PROFILES[profileId.toLowerCase()] !== undefined;
}

/**
 * Whether black-ink simulation is available in this build.
 *
 * `false`: the ICC proofing transform family cannot express it. The UI must not
 * offer a control that implies it simulates ink.
 */
export const BLACK_INK_SIMULATION_SUPPORTED = false;

function effectiveConfigKey(config: ProofConfig): string {
  return [
    config.profileId,
    config.renderingIntent,
    config.blackPointCompensation ? 'bpc' : 'nobpc',
    config.simulatePaperColor ? 'paper' : 'nopaper',
  ].join('|');
}

/**
 * Ensure a proof converter is registered for the current document proof setup.
 *
 * Idempotent: repeated calls with an unchanged setup do no work, so this is
 * safe to call on every frame. Returns the current provider status.
 */
export async function ensureProofProvider(config: ProofConfig): Promise<ProofProviderStatus> {
  const key = effectiveConfigKey(config);
  if (engine && registeredConfigKey === key && registeredProfileId === config.profileId) {
    return lastStatus;
  }

  // Resolve the requested output condition BEFORE loading the module. A proof
  // condition we have no profile for is a naming/config problem, and reporting
  // "module unavailable" for it would send the user looking in the wrong place.
  const outputLabel = BUNDLED_OUTPUT_PROFILES[config.profileId.toLowerCase()];
  if (!outputLabel) {
    // A proof profile we do not actually have. Report it instead of proofing
    // against an unrelated bundled profile under the requested name.
    lastStatus = {
      available: false,
      reason: `no ICC profile bundled for proof condition "${config.profileId}"`,
    };
    return lastStatus;
  }

  const module = await loadProofModule();
  if (!module) {
    lastStatus = {
      available: false,
      reason: `colour WASM module unavailable for proof condition "${config.profileId}"`,
    };
    return lastStatus;
  }

  try {
    if (!engine) {
      engine = new module.WasmProofEngine();
      engine.set_display_profile('sRGB', module.wasm_bundled_srgb_profile());
    }
    engine.set_output_profile(outputLabel, module.wasm_bundled_cmyk_profile());
  } catch (error) {
    lastStatus = {
      available: false,
      reason: `ICC proofing transform could not be built: ${String(error)}`,
    };
    return lastStatus;
  }

  // Re-register so the shared registry's converter carries these parameters.
  // `@varve/shared` keys converters by profile id only.
  registerProfileProofConverterNormalized(config.profileId, (rgba) => {
    const proofed = proofPixel([rgba[0], rgba[1], rgba[2]], config);
    if (!proofed) return null;
    // Preserve the caller's alpha: alpha is coverage, not colour.
    return [proofed[0], proofed[1], proofed[2], rgba[3]];
  });
  // A real gamut-check pipeline, so "out of gamut" is answered by the CMM
  // rather than by "did the proofed value move".
  registerProfileGamutChecker(config.profileId, (rgba) =>
    proofIsOutOfGamut([rgba[0], rgba[1], rgba[2]], config),
  );

  const support = engine.simulation_support(config.simulatePaperColor, config.simulateBlackInk);
  let totalAreaCoverage: number | undefined;
  try {
    totalAreaCoverage = engine.total_area_coverage();
  } catch {
    totalAreaCoverage = undefined;
  }

  registeredConfigKey = key;
  registeredProfileId = config.profileId;
  lastStatus = {
    available: true,
    outputProfileName: outputLabel,
    outputProfileFingerprint: engine.output_profile_fingerprint(),
    totalAreaCoverage,
    simulationSupport: {
      renderingIntent: support[0] === 1,
      blackPointCompensation: support[1] === 1,
      paperColor: support[2] === 1,
      blackInk: support[3] === 1,
    },
  };
  return lastStatus;
}

/**
 * Apply soft proofing to a frame's render items.
 *
 * Returns the identical array when proofing is off or unavailable, so callers
 * can skip downstream work. The input array and its items are never mutated:
 * proofing is display-only and must not reach caches, history or export.
 */
export function applyProofToFrame(
  items: RenderItem[],
  config: ProofTransformConfig | null,
): RenderItem[] {
  if (!config || !lastStatus.available) return items;
  return applyProofToIr(items, config);
}

/** Test seam: drop the cached module/engine and registry state. */
export function resetProofProviderForTests(): void {
  modulePromise = null;
  engine = null;
  registeredConfigKey = null;
  registeredProfileId = null;
  lastStatus = { available: false, reason: 'not initialised' };
}
