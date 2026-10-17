import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetWasmCapabilitySnapshot,
  _setWasmCapabilitySnapshotForTests,
  type WasmCapabilitySnapshot,
  type WasmRuntimeCapabilities,
} from './runtimeCapabilities';
import {
  _resetWasmEngineForTests,
  getWasmEngineAttribution,
  loadWasmEngineModule,
  setWasmArtifactPreference,
} from './wasmLoader';

function capsFor(simdValidated: boolean): WasmCapabilitySnapshot {
  const wasm: WasmRuntimeCapabilities = {
    apiPresent: true,
    baselineValidated: true,
    simdValidated,
    threadsValidated: false,
    sharedArrayBufferAvailable: false,
    crossOriginIsolated: false,
    threadsUsable: false,
  };
  return { wasm, workerPresent: true, offscreenCanvasPresent: true, secureContext: true };
}

/** Every request fails with a structural HTTP status; no glue is ever imported. */
function stubFetchStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status })),
  );
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe('WASM artifact selection', () => {
  afterEach(() => {
    _resetWasmEngineForTests();
    _resetWasmCapabilitySnapshot();
    setWasmArtifactPreference('auto');
    vi.unstubAllGlobals();
  });

  it('never fetches or claims the SIMD artifact when the engine cannot validate it', async () => {
    _setWasmCapabilitySnapshotForTests(capsFor(false));
    _resetWasmEngineForTests();
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWasmEngineModule()).resolves.toBeNull();

    const urls = requestedUrls(fetchMock);
    expect(urls.some((url) => url.includes('varve_wasm_simd_bg.wasm'))).toBe(false);
    expect(urls.some((url) => url.includes('varve_wasm_bg.wasm'))).toBe(true);

    const attribution = getWasmEngineAttribution();
    expect(attribution.artifact).toBe('none');
    expect(attribution.simdValidated).toBe(false);
    expect(attribution.skipped).toBe('simd-unsupported');
    expect(attribution.fallbacks).toHaveLength(1);
    expect(attribution.fallbacks[0]).toMatchObject({ artifact: 'baseline', stage: 'head' });
  });

  it('tries SIMD first on a validated engine, then the baseline artifact', async () => {
    _setWasmCapabilitySnapshotForTests(capsFor(true));
    _resetWasmEngineForTests();
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWasmEngineModule()).resolves.toBeNull();

    const urls = requestedUrls(fetchMock);
    expect(urls[0]).toContain('varve_wasm_simd_bg.wasm');
    expect(urls[1]).toContain('varve_wasm_bg.wasm');
    const attribution = getWasmEngineAttribution();
    expect(attribution.skipped).toBeNull();
    expect(attribution.fallbacks.map((attempt) => attempt.artifact)).toEqual(['simd', 'baseline']);
  });

  it('a baseline preference skips SIMD even when the engine supports it', async () => {
    _setWasmCapabilitySnapshotForTests(capsFor(true));
    setWasmArtifactPreference('baseline');
    _resetWasmEngineForTests();
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWasmEngineModule()).resolves.toBeNull();

    expect(requestedUrls(fetchMock).some((url) => url.includes('_simd_'))).toBe(false);
    expect(getWasmEngineAttribution().skipped).toBe('simd-not-preferred');
  });

  it('records the stage a candidate failed at, so a missing glue is distinguishable', async () => {
    _setWasmCapabilitySnapshotForTests(capsFor(false));
    _resetWasmEngineForTests();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // The binary is present; the JavaScript glue is not.
      if (url.endsWith('varve_wasm_bg.wasm')) return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadWasmEngineModule()).resolves.toBeNull();

    const attribution = getWasmEngineAttribution();
    expect(attribution.fallbacks).toHaveLength(1);
    expect(attribution.fallbacks[0]?.stage).toBe('glue');
  });

  it('reports the validated capability before any load has been attempted', () => {
    _setWasmCapabilitySnapshotForTests(capsFor(true));
    _resetWasmEngineForTests();
    const attribution = getWasmEngineAttribution();
    expect(attribution.simdValidated).toBe(true);
    expect(attribution.artifact).toBe('none');
    expect(attribution.activeUrl).toBeNull();
  });

  it('keeps fallback attribution bounded', async () => {
    _setWasmCapabilitySnapshotForTests(capsFor(true));
    _resetWasmEngineForTests();
    stubFetchStatus(503);
    for (let run = 0; run < 3; run += 1) {
      _resetWasmEngineForTests();
      await loadWasmEngineModule();
    }
    expect(getWasmEngineAttribution().fallbacks.length).toBeLessThanOrEqual(4);
    for (const attempt of getWasmEngineAttribution().fallbacks) {
      expect(attempt.reason.length).toBeLessThanOrEqual(181);
      expect(attempt.reason).not.toContain('\n');
    }
  });
});
