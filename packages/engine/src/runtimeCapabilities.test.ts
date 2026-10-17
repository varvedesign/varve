import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetWasmCapabilitySnapshot,
  _setWasmCapabilitySnapshotForTests,
  getWasmCapabilitySnapshot,
  probeWasmCapability,
  type WasmCapabilitySnapshot,
  type WasmRuntimeCapabilities,
  wasmArtifactCandidates,
} from './runtimeCapabilities';

function wasmCaps(patch: Partial<WasmRuntimeCapabilities> = {}): WasmRuntimeCapabilities {
  return {
    apiPresent: true,
    baselineValidated: true,
    simdValidated: false,
    threadsValidated: false,
    sharedArrayBufferAvailable: false,
    crossOriginIsolated: false,
    threadsUsable: false,
    ...patch,
  };
}

function capsFor(patch: Partial<WasmRuntimeCapabilities> = {}): WasmCapabilitySnapshot {
  return {
    wasm: wasmCaps(patch),
    workerPresent: true,
    offscreenCanvasPresent: true,
    secureContext: true,
  };
}

describe('runtimeCapabilities probe', () => {
  afterEach(() => {
    _resetWasmCapabilitySnapshot();
    vi.unstubAllGlobals();
  });

  it('reports the real prerequisites for a threaded build, not API presence', () => {
    // Shared memory validates, but the buffer cannot be constructed and the
    // context is not isolated: a threaded build could not run.
    const isolatedOnly = probeWasmCapability({
      wasm: WebAssembly,
      sharedArrayBuffer: undefined,
      crossOriginIsolated: true,
    });
    expect(isolatedOnly.wasm.threadsValidated).toBe(true);
    expect(isolatedOnly.wasm.sharedArrayBufferAvailable).toBe(false);
    expect(isolatedOnly.wasm.threadsUsable).toBe(false);

    const usable = probeWasmCapability({
      wasm: WebAssembly,
      sharedArrayBuffer: SharedArrayBuffer,
      crossOriginIsolated: true,
    });
    expect(usable.wasm.sharedArrayBufferAvailable).toBe(true);
    expect(usable.wasm.threadsUsable).toBe(true);
  });

  it('treats a constructor that throws as unavailable', () => {
    function ThrowingBuffer(): never {
      throw new Error('not isolated');
    }
    const caps = probeWasmCapability({
      wasm: WebAssembly,
      sharedArrayBuffer: ThrowingBuffer as unknown as typeof SharedArrayBuffer,
      crossOriginIsolated: true,
    });
    expect(caps.wasm.sharedArrayBufferAvailable).toBe(false);
    expect(caps.wasm.threadsUsable).toBe(false);
  });

  it('reports no SIMD when the validator is missing', () => {
    const caps = probeWasmCapability({ wasm: {} as unknown as typeof WebAssembly });
    expect(caps.wasm.apiPresent).toBe(false);
    expect(caps.wasm.baselineValidated).toBe(false);
    expect(caps.wasm.simdValidated).toBe(false);
    expect(caps.wasm.threadsValidated).toBe(false);
  });

  it('runs a real v128 validation on this host', () => {
    // Not a mock: the committed probe bytes must be a valid SIMD module, and
    // this runtime must accept them.
    const caps = probeWasmCapability({ wasm: WebAssembly });
    expect(caps.wasm.baselineValidated).toBe(true);
    expect(caps.wasm.simdValidated).toBe(true);
    // Same for the shared-memory/atomics probe. Both shipped probes were
    // malformed before this change, so these assertions are the regression.
    expect(caps.wasm.threadsValidated).toBe(true);
  });

  it('selects SIMD only after validation, and always keeps a baseline fallback', () => {
    expect(wasmArtifactCandidates(wasmCaps({ simdValidated: false }))).toEqual(['baseline']);
    expect(wasmArtifactCandidates(wasmCaps({ simdValidated: true }))).toEqual(['simd', 'baseline']);
  });

  it('caches one probe per session and can be reset', () => {
    _setWasmCapabilitySnapshotForTests(null);
    const first = getWasmCapabilitySnapshot();
    expect(getWasmCapabilitySnapshot()).toBe(first);
    _resetWasmCapabilitySnapshot();
    expect(getWasmCapabilitySnapshot()).not.toBe(first);
  });
});

describe('runtimeCapabilities with a pinned environment', () => {
  beforeEach(() => {
    _setWasmCapabilitySnapshotForTests(capsFor({ simdValidated: true }));
  });
  afterEach(() => {
    _resetWasmCapabilitySnapshot();
    vi.unstubAllGlobals();
  });

  it('pinned capabilities are what consumers read', () => {
    expect(getWasmCapabilitySnapshot().wasm.simdValidated).toBe(true);
    expect(getWasmCapabilitySnapshot().wasm.threadsUsable).toBe(false);
  });
});
