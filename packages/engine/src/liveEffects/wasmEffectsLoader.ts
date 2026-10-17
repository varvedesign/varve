import { resolveAppAssetUrl } from '../assets';
import { fetchWasmAsset } from '../wasmLoader';
import type { EffectDispatchRequest } from './dispatch';

const EFFECT_KERNEL_ABI_VERSION = 1;
const PIXEL_FORMAT = 'rgba8-straight-srgb';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 4_194_304;
const VERIFIED_PREVIEW_EFFECTS = new Set([
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
]);

interface WasmEffectsAbi {
  readonly kernelAbi: number;
  readonly pixelFormat: string;
  readonly maxDimension: number;
  readonly maxPixels: number;
  readonly effects: readonly string[];
}

export interface WasmEffectsModule {
  wasm_effects_abi_json(): string;
  wasm_apply_effect_json(requestJson: string, rgba: Uint8Array): Uint8Array;
}

let effectsModulePromise: Promise<WasmEffectsModule | null> | undefined;

/** Bloom remains on the TS reference until its current output matches exactly. */
export function canUseWasmEffect(request: EffectDispatchRequest): boolean {
  if (request.effect === 'dither') {
    const algorithm = request.params.algorithm ?? 'floyd-steinberg';
    return (
      request.params.paletteMode !== 'none' && algorithm !== 'bayer' && algorithm !== 'blue-noise'
    );
  }
  return VERIFIED_PREVIEW_EFFECTS.has(request.effect);
}

/** Loads the baseline/SIMD effect exports once, without requiring worker threads. */
export function tryLoadWasmEffects(): Promise<WasmEffectsModule | null> {
  effectsModulePromise ??= loadWasmEffectsUncached().then((module) => {
    if (!module) effectsModulePromise = undefined;
    return module;
  });
  return effectsModulePromise;
}

export function applyWasmEffect(
  module: WasmEffectsModule,
  request: EffectDispatchRequest,
  rgba: Uint8Array,
): Uint8Array {
  validateWasmEffectRequest(module, request, rgba.byteLength);
  const output = module.wasm_apply_effect_json(JSON.stringify(request), rgba);
  if (!(output instanceof Uint8Array) || output.byteLength !== rgba.byteLength) {
    throw new Error('WASM effect kernel returned an invalid RGBA buffer.');
  }
  return output;
}

function validateWasmEffectRequest(
  module: WasmEffectsModule,
  request: EffectDispatchRequest,
  rgbaLength: number,
): void {
  const abiJson = module.wasm_effects_abi_json();
  if (abiJson.length > MAX_REQUEST_BYTES) throw new Error('WASM effect ABI exceeds its limit.');
  const abi = JSON.parse(abiJson) as WasmEffectsAbi;
  if (
    abi.kernelAbi !== EFFECT_KERNEL_ABI_VERSION ||
    abi.pixelFormat !== PIXEL_FORMAT ||
    abi.maxDimension < MAX_DIMENSION ||
    abi.maxPixels < MAX_PIXELS ||
    !Array.isArray(abi.effects) ||
    !canUseWasmEffect(request) ||
    !abi.effects.includes(request.effect)
  ) {
    throw new Error('WASM effect ABI is incompatible with the preview request.');
  }
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > MAX_DIMENSION ||
    request.height > MAX_DIMENSION ||
    request.width * request.height > MAX_PIXELS ||
    rgbaLength !== request.width * request.height * 4
  ) {
    throw new Error('WASM effect request has invalid dimensions or RGBA bytes.');
  }
  const requestJson = JSON.stringify(request);
  if (new TextEncoder().encode(requestJson).byteLength > MAX_REQUEST_BYTES) {
    throw new Error('WASM effect request JSON exceeds its limit.');
  }
}

async function loadWasmEffectsUncached(): Promise<WasmEffectsModule | null> {
  const base = resolveAppAssetUrl('wasm/');
  for (const wasmUrl of [`${base}varve_wasm_simd_bg.wasm`, `${base}varve_wasm_bg.wasm`]) {
    let blobUrl: string | null = null;
    try {
      const response = await fetchWasmAsset(wasmUrl, { method: 'HEAD' });
      if (!response.ok) continue;
      const jsUrl = wasmUrl.replace('_bg.wasm', '.js').replace('_simd_bg.wasm', '_simd.js');
      const jsSource = await fetchWasmAsset(jsUrl).then((asset) => asset.text());
      blobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'text/javascript' }));
      const module = (await import(/* @vite-ignore */ blobUrl)) as WasmEffectsModule & {
        default: (options?: {
          module_or_path?: WebAssembly.Module | BufferSource | Promise<BufferSource>;
        }) => Promise<void>;
      };
      await module.default({
        module_or_path: fetchWasmAsset(wasmUrl).then((asset) => asset.arrayBuffer()),
      });
      const abiJson = module.wasm_effects_abi_json();
      if (abiJson.length > MAX_REQUEST_BYTES) continue;
      const abi = JSON.parse(abiJson) as WasmEffectsAbi;
      if (
        abi.kernelAbi !== EFFECT_KERNEL_ABI_VERSION ||
        abi.pixelFormat !== PIXEL_FORMAT ||
        !Array.isArray(abi.effects)
      ) {
        continue;
      }
      return module;
    } catch {
      // SIMD, fetch, instantiation, or ABI failures fall through to baseline.
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }
  return null;
}
