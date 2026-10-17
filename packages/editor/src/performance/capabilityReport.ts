/**
 * On-demand, local-only runtime capability report.
 *
 * This is deliberately a diagnostic snapshot rather than a fingerprint or a
 * render-policy input. Static API presence and bounded dynamic probes are
 * reported separately. Probe failures are represented by stable status codes;
 * browser exception text, user-agent strings, document data, and file names
 * never leave this module.
 */

import {
  getColourWasmAttribution,
  getWasmCapabilitySnapshot,
  getWasmEngineAttribution,
} from '@varve/engine';
import { getPlatformInfo } from '@varve/platform';
import { detectPlatformCapabilities, type PlatformCapabilities } from '../canvas/adaptiveProfile';
import {
  type OffscreenProbeDetail,
  probeOffscreenCapability,
} from '../render/offscreenCapabilityProbe';
import { ensureWebGpuCapabilityProbe, type WebGpuCapabilityProbe } from './webGpuProbe';

export type { WebGpuCapabilityProbe } from './webGpuProbe';

export const CAPABILITY_REPORT_SCHEMA_VERSION = 1 as const;

export type CapabilityProbeStatus = 'supported' | 'unavailable' | 'failed';

export interface WebGlCapabilityProbe {
  apiPresent: boolean;
  contextCreated: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  contextReleased: boolean;
  status: CapabilityProbeStatus;
}

export interface WasmCapabilityProbe {
  apiPresent: boolean;
  baselineValidated: boolean;
  simdValidated: boolean;
  threadsValidated: boolean;
  threadsUsable: boolean;
  /**
   * Artifact the loader actually instantiated this session. `none` means it is
   * still loading, or every candidate failed (see `fallbacks`). A SIMD file on
   * disk does not make this `simd`.
   */
  activeArtifact: 'simd' | 'baseline' | 'none';
  activeArtifactVersion: string | null;
  /** Candidate that was intentionally not attempted. */
  skipped: 'simd-unsupported' | 'simd-not-preferred' | null;
  /** Bounded structural failure reasons; no stack traces. */
  fallbacks: readonly string[];
  /** The colour engine ships baseline-only (no v128 instructions measured). */
  colourArtifact: 'baseline' | 'none';
}

export interface StorageCapabilityProbe {
  indexedDbPresent: boolean;
  storageManagerPresent: boolean;
  estimateStatus: CapabilityProbeStatus;
  usageBytes?: number;
  quotaBytes?: number;
  persistedStatus: CapabilityProbeStatus;
  persisted?: boolean;
}

export interface FileCapabilityProbe {
  fileSystemAccessApi: boolean;
  fileInputFallback: boolean;
  blobDownload: boolean;
  clipboardImageRead: boolean;
  localFontQuery: boolean;
}

export interface CapabilityReport {
  schemaVersion: typeof CAPABILITY_REPORT_SCHEMA_VERSION;
  collectedAt: string;
  runtime: {
    kind: ReturnType<typeof getPlatformInfo>['kind'];
    os: ReturnType<typeof getPlatformInfo>['os'];
    secureContext: boolean;
    crossOriginIsolated: boolean;
    visibilityState: string;
    documentWasDiscarded: boolean;
    viewportCss: { width: number; height: number };
    devicePixelRatio: number;
  };
  platform: {
    capabilities: readonly string[];
    hasTauriIpc: boolean;
    hasNativeFs: boolean;
    hasWebGpu: boolean;
    hasWebWorker: boolean;
    hasWasm: boolean;
  };
  adaptiveProfile: PlatformCapabilities;
  graphics: {
    webgl: WebGlCapabilityProbe;
    webgpu: WebGpuCapabilityProbe;
  };
  worker: {
    workerApiPresent: boolean;
    offscreenCanvasApiPresent: boolean;
    createImageBitmapApiPresent: boolean;
    offscreen: Pick<
      OffscreenProbeDetail,
      'capability' | 'stage' | 'durationMs' | 'mainThreadPixelsVerified'
    >;
  };
  wasm: WasmCapabilityProbe;
  storage: StorageCapabilityProbe;
  files: FileCapabilityProbe;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function hasFunction(value: unknown): boolean {
  return typeof value === 'function';
}

function getNavigatorRecord(): Record<string, unknown> {
  return typeof navigator === 'undefined' ? {} : (navigator as unknown as Record<string, unknown>);
}

function getWindowRecord(): Record<string, unknown> {
  return typeof window === 'undefined' ? {} : (window as unknown as Record<string, unknown>);
}

function probeWebGl(): WebGlCapabilityProbe {
  const apiPresent =
    typeof WebGLRenderingContext !== 'undefined' || typeof WebGL2RenderingContext !== 'undefined';
  if (typeof document === 'undefined') {
    return {
      apiPresent,
      contextCreated: false,
      contextKind: null,
      contextReleased: false,
      status: 'unavailable',
    };
  }

  try {
    const canvas = document.createElement('canvas');
    const webgl2 = canvas.getContext('webgl2');
    const context = webgl2 ?? canvas.getContext('webgl');
    if (!context) {
      return {
        apiPresent,
        contextCreated: false,
        contextKind: null,
        contextReleased: false,
        status: apiPresent ? 'failed' : 'unavailable',
      };
    }
    let contextReleased = false;
    try {
      (
        context as unknown as {
          getExtension?: (name: string) => { loseContext?: () => void } | null;
        }
      )
        .getExtension?.('WEBGL_lose_context')
        ?.loseContext?.();
      contextReleased = true;
    } catch {
      // The context was created; cleanup is best effort in older engines.
    }
    return {
      apiPresent: true,
      contextCreated: true,
      contextKind: webgl2 ? 'webgl2' : 'webgl',
      contextReleased,
      status: 'supported',
    };
  } catch {
    return {
      apiPresent,
      contextCreated: false,
      contextKind: null,
      contextReleased: false,
      status: 'failed',
    };
  }
}

function probeWasm(): WasmCapabilityProbe {
  // One probe implementation for the loader and the report, so the report can
  // never describe a capability the loader did not use (and vice versa).
  const wasm = getWasmCapabilitySnapshot().wasm;
  const engine = getWasmEngineAttribution();
  return {
    apiPresent: wasm.apiPresent,
    baselineValidated: wasm.baselineValidated,
    simdValidated: wasm.simdValidated,
    threadsValidated: wasm.threadsValidated,
    threadsUsable: wasm.threadsUsable,
    activeArtifact: engine.artifact,
    activeArtifactVersion: engine.version,
    skipped: engine.skipped,
    fallbacks: engine.fallbacks.map(
      (attempt) => `${attempt.artifact}:${attempt.stage}:${attempt.reason}`,
    ),
    colourArtifact: getColourWasmAttribution().artifact,
  };
}

async function probeStorage(): Promise<StorageCapabilityProbe> {
  const nav = getNavigatorRecord();
  const storage = nav.storage as
    | {
        estimate?: () => Promise<{ usage?: unknown; quota?: unknown }>;
        persisted?: () => Promise<boolean>;
      }
    | undefined;
  const report: StorageCapabilityProbe = {
    indexedDbPresent: typeof indexedDB !== 'undefined',
    storageManagerPresent: storage !== undefined,
    estimateStatus: storage && hasFunction(storage.estimate) ? 'failed' : 'unavailable',
    persistedStatus: storage && hasFunction(storage.persisted) ? 'failed' : 'unavailable',
  };

  if (storage && hasFunction(storage.estimate)) {
    try {
      const estimateFn = storage.estimate;
      if (!estimateFn) return report;
      const estimate = await estimateFn();
      report.usageBytes = finiteNumber(estimate.usage);
      report.quotaBytes = finiteNumber(estimate.quota);
      report.estimateStatus = 'supported';
    } catch {
      report.estimateStatus = 'failed';
    }
  }
  if (storage && hasFunction(storage.persisted)) {
    try {
      const persistedFn = storage.persisted;
      if (!persistedFn) return report;
      report.persisted = await persistedFn();
      report.persistedStatus = 'supported';
    } catch {
      report.persistedStatus = 'failed';
    }
  }
  return report;
}

function probeFiles(): FileCapabilityProbe {
  const nav = getNavigatorRecord();
  const win = getWindowRecord();
  const clipboard = nav.clipboard as { read?: unknown } | undefined;
  return {
    fileSystemAccessApi: hasFunction(win.showOpenFilePicker) && hasFunction(win.showSaveFilePicker),
    fileInputFallback: typeof document !== 'undefined',
    blobDownload:
      typeof Blob !== 'undefined' && typeof URL !== 'undefined' && hasFunction(URL.createObjectURL),
    clipboardImageRead: hasFunction(clipboard?.read),
    localFontQuery: hasFunction(win.queryLocalFonts),
  };
}

function snapshotOffscreen(detail: OffscreenProbeDetail): CapabilityReport['worker']['offscreen'] {
  return {
    capability: detail.capability,
    stage: detail.stage,
    durationMs: finiteNumber(detail.durationMs),
    mainThreadPixelsVerified: detail.mainThreadPixelsVerified,
  };
}

function snapshotRuntime(): CapabilityReport['runtime'] {
  const win = getWindowRecord();
  const doc = typeof document === 'undefined' ? undefined : document;
  const viewportWidth = finiteNumber(win.innerWidth) ?? 0;
  const viewportHeight = finiteNumber(win.innerHeight) ?? 0;
  const devicePixelRatio = finiteNumber(win.devicePixelRatio) ?? 1;
  return {
    kind: getPlatformInfo().kind,
    os: getPlatformInfo().os,
    secureContext: Boolean(win.isSecureContext),
    crossOriginIsolated: Boolean(win.crossOriginIsolated),
    visibilityState: doc?.visibilityState ?? 'unknown',
    documentWasDiscarded: Boolean(
      doc && (doc as Document & { wasDiscarded?: boolean }).wasDiscarded,
    ),
    viewportCss: { width: viewportWidth, height: viewportHeight },
    devicePixelRatio,
  };
}

/** Collect one bounded capability snapshot. It never uploads or mutates storage. */
export async function collectCapabilityReport(): Promise<CapabilityReport> {
  const platform = getPlatformInfo();
  const adaptiveProfile = detectPlatformCapabilities();
  const offscreenPromise = probeOffscreenCapability();
  const [webgpu, offscreen, storage] = await Promise.all([
    ensureWebGpuCapabilityProbe(),
    offscreenPromise,
    probeStorage(),
  ]);
  const webgl = probeWebGl();
  const wasm = probeWasm();

  return {
    schemaVersion: CAPABILITY_REPORT_SCHEMA_VERSION,
    collectedAt: new Date().toISOString(),
    runtime: snapshotRuntime(),
    platform: {
      capabilities: [...platform.capabilities].sort(),
      hasTauriIpc: platform.hasTauriIpc,
      hasNativeFs: platform.hasNativeFs,
      hasWebGpu: platform.hasWebGpu,
      hasWebWorker: platform.hasWebWorker,
      hasWasm: platform.hasWasm,
    },
    adaptiveProfile: { ...adaptiveProfile },
    graphics: { webgl, webgpu },
    worker: {
      workerApiPresent: typeof Worker !== 'undefined',
      offscreenCanvasApiPresent: typeof OffscreenCanvas !== 'undefined',
      createImageBitmapApiPresent: typeof createImageBitmap === 'function',
      offscreen: snapshotOffscreen(offscreen),
    },
    wasm,
    storage,
    files: probeFiles(),
  };
}

export function serializeCapabilityReport(report: CapabilityReport): string {
  return JSON.stringify(report, null, 2);
}
