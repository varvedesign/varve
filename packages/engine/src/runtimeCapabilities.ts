/**
 * Runtime capability probe for the WASM acceleration paths.
 *
 * The renderer chooses between a baseline artifact and a `+simd128` artifact,
 * so "the SIMD build exists" is not the question that matters — the question is
 * whether *this* engine can validate and instantiate it. Presence of a
 * `SharedArrayBuffer` constructor is likewise not thread support: it is hidden
 * (or throws on construction) unless the document is cross-origin isolated.
 *
 * This module is the single source of truth for those answers. It is used by
 * `wasmLoader` (artifact selection), by the editor's capability report, and by
 * the render-path diagnostics, so a report can never claim an acceleration the
 * loader did not select.
 *
 * Probes are bounded and run at most once per session: two `WebAssembly.validate`
 * calls on modules of 12-24 bytes, one typed-array construction attempt, and
 * property reads. Nothing here allocates a worker, a canvas or an image.
 */

export interface WasmRuntimeCapabilities {
  /** `WebAssembly.validate` exists and accepts the baseline probe. */
  apiPresent: boolean;
  baselineValidated: boolean;
  /** The engine accepts a module that uses `v128` (WebAssembly SIMD). */
  simdValidated: boolean;
  /** The engine accepts a shared-memory declaration (threads feature). */
  threadsValidated: boolean;
  /** `SharedArrayBuffer` exists *and* can be constructed in this context. */
  sharedArrayBufferAvailable: boolean;
  /** The document is cross-origin isolated (`COOP` + `COEP`). */
  crossOriginIsolated: boolean;
  /**
   * A threaded WASM build could actually run: the validator accepts shared
   * memory, the buffer exists, and the context is isolated. This does not
   * imply a threaded artifact is shipped.
   */
  threadsUsable: boolean;
}

export interface WasmCapabilitySnapshot {
  wasm: WasmRuntimeCapabilities;
  workerPresent: boolean;
  offscreenCanvasPresent: boolean;
  secureContext: boolean;
}

/**
 * Minimal valid module that uses `v128`.
 *
 * Verified bytes: `i32x4.add` of two constants, an exported function returning
 * one lane. It is validated by `runtimeCapabilities.test.ts` against the real
 * engine, and it replaces a 29-byte probe that was malformed (its `i8x16.splat`
 * was applied to a `v128`), which made the capability report answer "no SIMD"
 * on every browser regardless of support.
 */
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 46, 1,
  44, 0, 253, 12, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 253, 12, 5, 0, 0, 0, 6, 0, 0, 0,
  7, 0, 0, 0, 8, 0, 0, 0, 253, 174, 1, 253, 27, 0, 11,
]);

/**
 * Shared memory plus one `i32.atomic.load`. Validating this proves the engine
 * knows the threads feature; it deliberately does not allocate the memory. The
 * previous constant declared a five-byte memory section with four bytes of
 * payload, so it was invalid on every engine.
 */
const WASM_THREADS_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 7, 5, 1, 1,
  102, 0, 0, 10, 10, 1, 8, 0, 65, 0, 254, 16, 2, 0, 11,
]);

const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/** Test/AB seam: a caller may supply a different view of the environment. */
export interface CapabilityEnvironment {
  wasm?: typeof WebAssembly;
  sharedArrayBuffer?: typeof SharedArrayBuffer;
  crossOriginIsolated?: boolean;
  secureContext?: boolean;
  hasWorker?: boolean;
  hasOffscreenCanvas?: boolean;
}

function defaultEnvironment(): CapabilityEnvironment {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  return {
    wasm: typeof WebAssembly === 'undefined' ? undefined : WebAssembly,
    sharedArrayBuffer:
      typeof SharedArrayBuffer === 'undefined'
        ? undefined
        : (SharedArrayBuffer as typeof SharedArrayBuffer),
    crossOriginIsolated: Boolean(globalRecord.crossOriginIsolated),
    secureContext: Boolean(globalRecord.isSecureContext),
    hasWorker: typeof Worker !== 'undefined',
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
}

function canValidate(wasm: typeof WebAssembly | undefined, bytes: Uint8Array): boolean {
  if (!wasm || typeof wasm.validate !== 'function') return false;
  try {
    return wasm.validate(bytes as unknown as BufferSource);
  } catch {
    return false;
  }
}

function canConstructSharedArrayBuffer(ctor: typeof SharedArrayBuffer | undefined): boolean {
  if (!ctor) return false;
  try {
    // Some hosts expose the constructor but throw on construction when the
    // context is not isolated. That is the distinction that matters.
    const probe = new ctor(8);
    return probe.byteLength === 8;
  } catch {
    return false;
  }
}

/** Pure probe: every input comes from `env`, so tests never touch real globals. */
export function probeWasmCapability(
  env: CapabilityEnvironment = defaultEnvironment(),
): WasmCapabilitySnapshot {
  const wasm = env.wasm;
  const baselineValidated = canValidate(wasm, EMPTY_MODULE);
  const simdValidated = canValidate(wasm, WASM_SIMD_PROBE);
  const threadsValidated = canValidate(wasm, WASM_THREADS_PROBE);
  const sharedArrayBufferAvailable = canConstructSharedArrayBuffer(env.sharedArrayBuffer);
  const crossOriginIsolated = env.crossOriginIsolated === true;

  return {
    wasm: {
      apiPresent: Boolean(wasm && typeof wasm.validate === 'function'),
      baselineValidated,
      simdValidated,
      threadsValidated,
      sharedArrayBufferAvailable,
      crossOriginIsolated,
      threadsUsable: threadsValidated && sharedArrayBufferAvailable && crossOriginIsolated,
    },
    workerPresent: env.hasWorker === true,
    offscreenCanvasPresent: env.hasOffscreenCanvas === true,
    secureContext: env.secureContext === true,
  };
}

let cachedCapabilities: WasmCapabilitySnapshot | null = null;

/** Session-cached capabilities. Never triggers work more than once. */
export function getWasmCapabilitySnapshot(): WasmCapabilitySnapshot {
  if (!cachedCapabilities) cachedCapabilities = probeWasmCapability();
  return cachedCapabilities;
}

/** Test seam: drop the cache so the next read re-probes. */
export function _resetWasmCapabilitySnapshot(): void {
  cachedCapabilities = null;
}

/** Test seam: pin a result without touching globals. */
export function _setWasmCapabilitySnapshotForTests(next: WasmCapabilitySnapshot | null): void {
  cachedCapabilities = next;
}

/** Which WASM artifacts the loader may attempt, in preference order. */
export type WasmArtifactKind = 'simd' | 'baseline';

/**
 * Candidate order for an artifact family. SIMD is only a candidate when the
 * engine validated it; otherwise the loader must not fetch, instantiate, or
 * claim it. A baseline artifact is always offered as the fallback (it is a
 * separate build, not a SIMD module that happens to run).
 */
export function wasmArtifactCandidates(
  capabilities: WasmRuntimeCapabilities = getWasmCapabilitySnapshot().wasm,
): WasmArtifactKind[] {
  return capabilities.simdValidated ? ['simd', 'baseline'] : ['baseline'];
}
