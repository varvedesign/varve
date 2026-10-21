/**
 * WASM module loader with feature detection.
 *
 * This module knows nothing about the `Engine` interface or the render pipeline —
 * it only loads the raw WASM exports (or returns null on failure) and caches the
 * in-flight load so concurrent callers (e.g. an idle-time prewarm racing an
 * explicit engine creation) share one fetch/instantiate attempt instead of two.
 * Shaping a loaded module into an `Engine`, and deciding what to do when loading
 * fails, are the caller's job (see engine.ts's `tryWasmEngine`).
 */
import { resolveAppAssetUrl } from './assets';
import { hitTest as stubHitTest } from './geometry';
import {
  getWasmCapabilitySnapshot,
  type WasmArtifactKind,
  wasmArtifactCandidates,
} from './runtimeCapabilities';
import type { SceneNode } from './types';

export interface WasmEngineModule {
  build_ir_json(nodesJson: string): string;
  hit_test_json(nodesJson: string, x: number, y: number): number;
  wasm_engine_version(): string;
}

let wasmModulePromise: Promise<WasmEngineModule | null> | null = null;
let prewarmStarted = false;

export type WasmArtifactPreference = 'auto' | 'baseline';

/** One artifact that was attempted, and where it failed. Bounded by the loop. */
export interface WasmArtifactAttempt {
  artifact: WasmArtifactKind;
  url: string;
  stage: 'head' | 'glue' | 'instantiate';
  /** Truncated, structural reason — never a full browser stack. */
  reason: string;
}

/**
 * Which artifact actually serves this session, and why. This is the value the
 * diagnostics surface reports: an artifact that exists on disk is not evidence
 * that it was selected, and a `+simd128` build is not evidence that the engine
 * accepted it.
 */
export interface WasmEngineAttribution {
  preference: WasmArtifactPreference;
  /** The engine validated a `v128` module before the SIMD candidate was tried. */
  simdValidated: boolean;
  artifact: WasmArtifactKind | 'none';
  activeUrl: string | null;
  /** Reported by the artifact itself (`wasm_engine_version`), when it loads. */
  version: string | null;
  /** A candidate that was never attempted, and the policy reason. */
  skipped: 'simd-unsupported' | 'simd-not-preferred' | null;
  /** Failed attempts, oldest first. At most one per candidate. */
  fallbacks: readonly WasmArtifactAttempt[];
}

const MAX_FALLBACKS = 4;
const MAX_REASON_CHARS = 180;

let wasmPreference: WasmArtifactPreference = 'auto';
let attribution: WasmEngineAttribution = {
  preference: 'auto',
  simdValidated: false,
  artifact: 'none',
  activeUrl: null,
  version: null,
  skipped: null,
  fallbacks: [],
};

export function getWasmEngineAttribution(): WasmEngineAttribution {
  // The capability is read fresh so a diagnostics snapshot taken before the
  // first load still reports what this engine can do.
  return { ...attribution, simdValidated: getWasmCapabilitySnapshot().wasm.simdValidated };
}

/**
 * Prefer the baseline artifact for the *next* load. Used by the A/B harness and
 * by diagnostics; a module that is already loaded stays active for the session
 * because in-flight frames hold references to it.
 */
export function setWasmArtifactPreference(preference: WasmArtifactPreference): void {
  wasmPreference = preference;
  attribution = { ...attribution, preference };
}

/** Test seam: clear the load cache and attribution so the next call re-selects. */
export function _resetWasmEngineForTests(): void {
  wasmModulePromise = null;
  prewarmStarted = false;
  attribution = {
    preference: wasmPreference,
    simdValidated: false,
    artifact: 'none',
    activeUrl: null,
    version: null,
    skipped: null,
    fallbacks: [],
  };
}

function truncateReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  return singleLine.length > MAX_REASON_CHARS
    ? `${singleLine.slice(0, MAX_REASON_CHARS)}…`
    : singleLine;
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return truncateReason(error.message || error.name);
  return truncateReason(String(error));
}

function artifactFileName(kind: WasmArtifactKind): string {
  return kind === 'simd' ? 'varve_wasm_simd_bg.wasm' : 'varve_wasm_bg.wasm';
}

function artifactJsName(wasmName: string): string {
  return wasmName.replace('_bg.wasm', '.js');
}

/**
 * The candidate list for the shared `varve_wasm` artifact family. SIMD is only
 * a candidate when the engine validated it; the baseline build is a distinct
 * artifact, so falling back is a real second attempt rather than a hope.
 */
function engineArtifactCandidates(): {
  kinds: WasmArtifactKind[];
  skipped: WasmEngineAttribution['skipped'];
} {
  if (wasmPreference === 'baseline') {
    return { kinds: ['baseline'], skipped: 'simd-not-preferred' };
  }
  const kinds = wasmArtifactCandidates();
  return { kinds, skipped: kinds.includes('simd') ? null : 'simd-unsupported' };
}

interface ArtifactModule {
  default: (opts?: {
    module_or_path?: WebAssembly.Module | BufferSource | Promise<BufferSource>;
  }) => Promise<unknown>;
  build_ir_json: (json: string) => string;
  hit_test_json: (json: string, x: number, y: number) => number;
  wasm_engine_version: () => string;
}

/**
 * Fetch and instantiate one artifact. Returns the module or a structural
 * failure; the caller decides whether to try the next candidate. Attribution is
 * written here because this is the only place that knows the real stage.
 */
async function tryLoadEngineArtifact(
  kind: WasmArtifactKind,
): Promise<{ mod: ArtifactModule | null; failure: WasmArtifactAttempt | null }> {
  const fileName = artifactFileName(kind);
  const wasmUrl = `${resolveAppAssetUrl('wasm/')}${fileName}`;
  let blobUrl: string | null = null;
  let stage: WasmArtifactAttempt['stage'] = 'head';
  try {
    const response = await fetchWasmAsset(wasmUrl, { method: 'HEAD' });
    if (!response.ok) {
      return {
        mod: null,
        failure: { artifact: kind, url: wasmUrl, stage, reason: `HTTP ${response.status}` },
      };
    }
    // Vite's dev server refuses to serve /public assets through its
    // module-transform pipeline — a direct `import(jsUrl)` throws
    // "should not be imported from source code" and blocks the app behind its
    // error overlay. Fetching the glue source and importing it from a blob:
    // URL sidesteps this dev-only restriction (works identically in
    // production, where there's no transform pipeline in the way).
    stage = 'glue';
    const jsSource = await fetchWasmAsset(
      `${resolveAppAssetUrl('wasm/')}${artifactJsName(fileName)}`,
    ).then((r) => r.text());
    blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));
    const mod = (await import(/* @vite-ignore */ blobUrl)) as unknown as ArtifactModule;
    stage = 'instantiate';
    // The generated glue's positional-argument form is deprecated (logs a
    // console warning on every call) in favor of a single options object.
    await mod.default({
      module_or_path: fetchWasmAsset(wasmUrl).then((r) => r.arrayBuffer()),
    });
    return { mod, failure: null };
  } catch (error) {
    return {
      mod: null,
      failure: { artifact: kind, url: wasmUrl, stage, reason: reasonOf(error) },
    };
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Fetch a runtime asset, using Cache Storage when the network is unavailable.
 *
 * The demo service worker normally serves these requests, but WASM can also be
 * fetched by a dedicated or blob worker whose request is not consistently
 * intercepted across browser versions. Cache Storage is available in workers,
 * so checking it here keeps the local-first fallback honest after an offline
 * reload without changing the native/Tauri path.
 */
export async function fetchWasmAsset(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (response.ok) return response;
    throw new Error(`WASM asset request failed (${response.status})`);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    if (typeof caches !== 'undefined') {
      try {
        const cached = await caches.match(input);
        if (init?.signal?.aborted) throw error;
        if (cached?.ok) return cached;
      } catch {
        // Cache Storage can be unavailable in private or restricted contexts.
      }
    }
    throw error;
  }
}

/** Warm the WASM engine during idle time so it's ready when first needed. */
export function prewarmWasmEngine(): void {
  if (prewarmStarted) return;
  prewarmStarted = true;
  // Use requestIdleCallback if available, otherwise setTimeout
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      void loadWasmEngineModule();
    });
  } else {
    setTimeout(() => {
      void loadWasmEngineModule();
    }, 500);
  }
}

/**
 * Load (or join an in-flight load of) the WASM engine module. Safe to call
 * concurrently from multiple call sites — everyone awaits the same promise
 * while a load is in flight, so there's exactly one fetch/instantiate attempt
 * running at a time. A successful load is cached forever; a failed one clears
 * the cache so the next call retries (matches prior behavior, which re-fetched
 * on every call after a failure — only the "two callers racing" case changes).
 */
export function loadWasmEngineModule(): Promise<WasmEngineModule | null> {
  if (!wasmModulePromise) {
    wasmModulePromise = loadWasmEngineModuleUncached().then((mod) => {
      if (!mod) wasmModulePromise = null;
      return mod;
    });
  }
  return wasmModulePromise;
}

async function loadWasmEngineModuleUncached(): Promise<WasmEngineModule | null> {
  const { kinds, skipped } = engineArtifactCandidates();
  const fallbacks: WasmArtifactAttempt[] = [];
  attribution = {
    preference: wasmPreference,
    simdValidated: getWasmCapabilitySnapshot().wasm.simdValidated,
    artifact: 'none',
    activeUrl: null,
    version: null,
    skipped,
    fallbacks,
  };

  for (const kind of kinds) {
    const { mod, failure } = await tryLoadEngineArtifact(kind);
    if (failure) {
      if (fallbacks.length < MAX_FALLBACKS) fallbacks.push(failure);
      continue;
    }
    if (!mod) continue;
    let version: string | null = null;
    try {
      version = mod.wasm_engine_version();
    } catch {
      // A version string is diagnostic metadata; its absence must not fail a
      // module whose exports otherwise work.
    }
    attribution = {
      ...attribution,
      artifact: kind,
      activeUrl: `${resolveAppAssetUrl('wasm/')}${artifactFileName(kind)}`,
      version,
      fallbacks,
    };
    return mod;
  }
  return null;
}

export function wasmHitTestFallback(
  nodes: SceneNode[],
  world: readonly [number, number],
): number | null {
  return stubHitTest(nodes, world);
}

// ── WASM trace module loader ──────────────────────────────────────────

export interface WasmTraceModule {
  trace_contours_json(
    pixels: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    minPixels: number,
    foreground?: string,
  ): string;
  trace_contours_json_opts?(
    pixels: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    minPixels: number,
    foreground: string | undefined,
    optionsJson: string,
  ): string;
  wasm_trace_version(): string;
}

let cachedTraceModule: WasmTraceModule | null = null;

export async function tryLoadTraceWasm(): Promise<WasmTraceModule | null> {
  if (cachedTraceModule) return cachedTraceModule;
  try {
    const base = resolveAppAssetUrl('wasm/');
    const candidates = engineArtifactCandidates().kinds.map(
      (kind) => `${base}${artifactFileName(kind)}`,
    );
    for (const wasmUrl of candidates) {
      let blobUrl: string | null = null;
      try {
        const response = await fetchWasmAsset(wasmUrl, { method: 'HEAD' });
        if (!response.ok) continue;
        const jsUrl = wasmUrl.replace('_bg.wasm', '.js').replace('_simd_bg.wasm', '_simd.js');
        const jsSource = await fetchWasmAsset(jsUrl).then((r) => r.text());
        blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));
        const mod = (await import(/* @vite-ignore */ blobUrl)) as {
          default: (opts?: {
            module_or_path?: WebAssembly.Module | BufferSource | Promise<BufferSource>;
          }) => Promise<void>;
          trace_contours_json: (
            pixels: Uint8Array,
            width: number,
            height: number,
            threshold: number,
            minPixels: number,
          ) => string;
          trace_contours_json_opts?: (
            pixels: Uint8Array,
            width: number,
            height: number,
            threshold: number,
            minPixels: number,
            foreground: string | undefined,
            optionsJson: string,
          ) => string;
          wasm_trace_version: () => string;
        };
        await mod.default({ module_or_path: fetchWasmAsset(wasmUrl).then((r) => r.arrayBuffer()) });
        cachedTraceModule = mod;
        return mod;
      } catch {
        // try the next candidate
      } finally {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    }
    return null;
  } catch {
    return null;
  }
}
