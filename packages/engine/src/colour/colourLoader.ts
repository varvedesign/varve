import { getWasmCapabilitySnapshot } from '../runtimeCapabilities';

export interface ColourWasmModule {
  wasm_rgb_to_cmyk(r: number, g: number, b: number): Uint8Array;
  wasm_cmyk_to_rgb(c: number, m: number, y: number, k: number): Uint8Array;
  wasm_rgb_to_cmyk_icc(
    r: number,
    g: number,
    b: number,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  wasm_convert_srgb_buffer_to_cmyk(
    data: Uint8Array,
    profileData: Uint8Array,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  wasm_validate_colour_profile(data: Uint8Array): boolean;
  wasm_colour_profile_info(data: Uint8Array): string;
  wasm_batch_rgb_to_cmyk_icc(
    data: Uint8Array,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
}

let cachedModule: ColourWasmModule | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Which colour artifact serves this session. The colour engine is built
 * baseline-only: the shipped `varve_colour_bg.wasm` contains no `v128`
 * instructions (verified by `just verify-wasm-simd`), so there is no SIMD
 * artifact to prefer and none is claimed.
 */
export interface ColourWasmAttribution {
  artifact: 'baseline' | 'none';
  activeUrl: string | null;
  simdValidated: boolean;
  simdArtifact: 'not-shipped';
  fallbacks: readonly WasmArtifactFailure[];
}

export interface WasmArtifactFailure {
  url: string;
  stage: 'head' | 'glue' | 'instantiate';
  reason: string;
}

const MAX_FALLBACKS = 4;
const MAX_REASON_CHARS = 180;

let attribution: ColourWasmAttribution = {
  artifact: 'none',
  activeUrl: null,
  simdValidated: false,
  simdArtifact: 'not-shipped',
  fallbacks: [],
};

export function getColourWasmAttribution(): ColourWasmAttribution {
  return { ...attribution, simdValidated: getWasmCapabilitySnapshot().wasm.simdValidated };
}

/** Test seam: clear the load cache and attribution. */
export function _resetColourWasmForTests(): void {
  cachedModule = null;
  initPromise = null;
  attribution = {
    artifact: 'none',
    activeUrl: null,
    simdValidated: false,
    simdArtifact: 'not-shipped',
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

const WASM_CANDIDATES = ['/wasm/varve_colour_bg.wasm'];

function wasmUrlToJsUrl(wasmUrl: string): string {
  return wasmUrl.replace('_bg.wasm', '.js');
}

async function tryLoadCandidate(
  wasmUrl: string,
): Promise<{ mod: ColourWasmModule | null; failure: WasmArtifactFailure | null }> {
  let stage: WasmArtifactFailure['stage'] = 'head';
  try {
    const headResp = await fetch(wasmUrl, { method: 'HEAD' });
    if (!headResp.ok) {
      return { mod: null, failure: { url: wasmUrl, stage, reason: `HTTP ${headResp.status}` } };
    }
    stage = 'glue';
    const jsUrl = wasmUrlToJsUrl(wasmUrl);
    const jsResp = await fetch(jsUrl);
    if (!jsResp.ok) {
      return { mod: null, failure: { url: wasmUrl, stage, reason: `HTTP ${jsResp.status}` } };
    }
    const jsCode = await jsResp.text();
    const blob = new Blob([jsCode], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const mod = (await import(/* @vite-ignore */ blobUrl)) as {
        default: (init: { module_or_path: Promise<ArrayBuffer> }) => Promise<ColourWasmModule>;
      };
      stage = 'instantiate';
      const module = await mod.default({
        module_or_path: fetch(wasmUrl).then((r) => r.arrayBuffer()),
      });
      return { mod: module as unknown as ColourWasmModule, failure: null };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (error) {
    return { mod: null, failure: { url: wasmUrl, stage, reason: reasonOf(error) } };
  }
}

export async function loadColourWasmModule(): Promise<ColourWasmModule | null> {
  if (cachedModule) return cachedModule;
  if (!initPromise) {
    initPromise = (async () => {
      const fallbacks: WasmArtifactFailure[] = [];
      attribution = {
        artifact: 'none',
        activeUrl: null,
        simdValidated: getWasmCapabilitySnapshot().wasm.simdValidated,
        simdArtifact: 'not-shipped',
        fallbacks,
      };
      for (const candidate of WASM_CANDIDATES) {
        const { mod, failure } = await tryLoadCandidate(candidate);
        if (failure) {
          if (fallbacks.length < MAX_FALLBACKS) fallbacks.push(failure);
          continue;
        }
        if (!mod) continue;
        cachedModule = mod;
        attribution = { ...attribution, artifact: 'baseline', activeUrl: candidate, fallbacks };
        return;
      }
    })();
  }
  await initPromise;
  return cachedModule;
}

export function prewarmColourWasm(): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as Window & typeof globalThis).requestIdleCallback(
      () => {
        void loadColourWasmModule();
      },
      { timeout: 2000 },
    );
  } else {
    setTimeout(() => void loadColourWasmModule(), 500);
  }
}

export interface ColourEngine {
  readonly backend: 'wasm';
  rgbToCmyk(r: number, g: number, b: number): Uint8Array;
  cmykToRgb(c: number, m: number, y: number, k: number): Uint8Array;
  rgbToCmykIcc(
    r: number,
    g: number,
    b: number,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  convertSrgbBufferToCmyk(
    data: Uint8Array,
    profileData: Uint8Array,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
  validateColourProfile(data: Uint8Array): boolean;
  colourProfileInfo(data: Uint8Array): Record<string, unknown>;
  batchRgbToCmykIcc(
    data: Uint8Array,
    profileName: string,
    renderingIntent: string,
    bpc: boolean,
  ): Uint8Array;
}

export function createColourEngineFromModule(mod: ColourWasmModule): ColourEngine {
  return {
    backend: 'wasm',
    rgbToCmyk(r: number, g: number, b: number): Uint8Array {
      return mod.wasm_rgb_to_cmyk(r, g, b);
    },
    cmykToRgb(c: number, m: number, y: number, k: number): Uint8Array {
      return mod.wasm_cmyk_to_rgb(c, m, y, k);
    },
    rgbToCmykIcc(
      r: number,
      g: number,
      b: number,
      profileName: string,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_rgb_to_cmyk_icc(r, g, b, profileName, renderingIntent, bpc);
    },
    convertSrgbBufferToCmyk(
      data: Uint8Array,
      profileData: Uint8Array,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_convert_srgb_buffer_to_cmyk(data, profileData, renderingIntent, bpc);
    },
    validateColourProfile(data: Uint8Array): boolean {
      return mod.wasm_validate_colour_profile(data);
    },
    colourProfileInfo(data: Uint8Array): Record<string, unknown> {
      return JSON.parse(mod.wasm_colour_profile_info(data)) as Record<string, unknown>;
    },
    batchRgbToCmykIcc(
      data: Uint8Array,
      profileName: string,
      renderingIntent: string,
      bpc: boolean,
    ): Uint8Array {
      return mod.wasm_batch_rgb_to_cmyk_icc(data, profileName, renderingIntent, bpc);
    },
  };
}
