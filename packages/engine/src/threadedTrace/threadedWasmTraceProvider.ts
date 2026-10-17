import { resolveAppAssetUrl } from '../assets';
import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';
import { getWasmCapabilitySnapshot } from '../runtimeCapabilities';
import type { TraceProvider } from '../upscaleProviders/types';
import { toRasterTraceResult } from '../upscaleProviders/wasmTraceProvider';
import { getSharedThreadedTraceHost } from './threadedTraceHost';

let artifactAvailable: Promise<boolean> | null = null;

function supportsOptions(options: RasterTraceOptions): boolean {
  return (
    options.traceMode !== 'centerline' &&
    options.mode !== 'pixel-art' &&
    (options.mode ?? 'monochrome') === 'monochrome'
  );
}

function hasThreadedArtifact(): Promise<boolean> {
  if (!artifactAvailable) {
    artifactAvailable = fetch(resolveAppAssetUrl('wasm/threads/varve_wasm_threads_bg.wasm'), {
      method: 'HEAD',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .then((available) => {
        if (!available) artifactAvailable = null;
        return available;
      });
  }
  return artifactAvailable;
}

export const threadedWasmTraceProvider: TraceProvider = {
  id: 'wasm-threaded-trace',
  label: 'CPU (threaded WASM)',
  async isAvailable(options, signal) {
    if (signal?.aborted || typeof Worker === 'undefined' || !supportsOptions(options)) return false;
    if (!getWasmCapabilitySnapshot().wasm.threadsUsable) return false;
    return hasThreadedArtifact();
  },
  async trace(imageData, options, signal): Promise<RasterTraceResult> {
    if (signal?.aborted) throw new Error('cancelled');
    const json = await getSharedThreadedTraceHost().trace(
      new Uint8Array(imageData.data),
      imageData.width,
      imageData.height,
      {
        threshold: options.threshold,
        minArea: options.minArea,
        foreground: options.foreground === 'light' ? 'light' : 'dark',
        cornerAngle: options.cornerAngle,
        maxError: options.maxError,
        simplifyTolerance: options.simplifyTolerance,
      },
      signal,
    );
    if (signal?.aborted) throw new Error('cancelled');
    return toRasterTraceResult(json);
  },
};

export function resetThreadedWasmTraceArtifactCheckForTests(): void {
  artifactAvailable = null;
}
