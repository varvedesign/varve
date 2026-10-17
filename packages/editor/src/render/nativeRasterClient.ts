/**
 * Native IR raster client — the frontend half of `crates/varve-accel::render`.
 *
 * Scope, stated precisely because the distinction is the whole point of this
 * module: the native stage *rasterizes* the render IR on the GPU and returns
 * pixels. It does not present them. The returned frame reaches the window
 * through the existing Canvas2D present surface, exactly like every other
 * frame, which is why device loss, unsupported content, and a paused stage all
 * degrade to "the authoritative replay keeps drawing" with no special case.
 *
 * This is deliberately separate from `@varve/engine`'s `nativeAcceleration.ts`
 * (native *compute*: discovery, self-test, effect kernels) and from
 * `gpuAdapter.ts` (the *browser* WebGPU adapter). A machine can have a usable
 * compute device and still decline to rasterize a frame, and the diagnostics
 * must not conflate the two.
 *
 * See ADR-0244 and `docs/architecture/native-render-stage.md`.
 */

import { isTauriRuntime } from '@varve/platform';

/** Mirrors `varve_accel::render::RejectReason::key`. */
export type NativeRasterRejectReason =
  | 'unsupported-primitive'
  | 'unsupported-paint'
  | 'unsupported-stroke'
  | 'unsupported-blend'
  | 'unsupported-effects'
  | 'unsupported-corner-smoothing'
  | 'empty-geometry'
  | 'too-many-vertices'
  | 'non-finite-transform'
  | 'out-of-budget';

/** Mirrors `varve_accel::render::AdmissionReport`. */
export interface NativeRasterAdmission {
  considered: number;
  admitted: number;
  rejected: number;
  reasons: Partial<Record<NativeRasterRejectReason, number>>;
}

/** Mirrors `varve_accel::render::FailureStage`. */
export type NativeRasterFailureStage = 'plan' | 'pipeline' | 'encode' | 'submit' | 'readback';

/** Mirrors `varve_accel::render::RenderHealth`. */
export interface NativeRasterHealth {
  consecutiveFailures: number;
  paused: boolean;
  pausedReason: string | null;
  lastErrorKey: string | null;
  lastErrorStage: NativeRasterFailureStage | null;
  deviceGeneration: number;
}

/** Mirrors `varve_accel::render::NativeRasterDiagnostics`. */
export interface NativeRasterDiagnostics {
  available: boolean;
  deviceName: string;
  backend: string;
  driver: string | null;
  sampleCount: number;
  stencilFormat: string;
  health: NativeRasterHealth;
  lastReport: NativeRasterAdmission | null;
  lastError: string | null;
  lastErrorStage: NativeRasterFailureStage | null;
  lastDrawCalls: number;
  lastBuildMs: number;
  lastEncodeMs: number;
  lastReadbackMs: number;
}

/** Mirrors `NativeRasterOutcome` in the desktop command layer. */
export interface NativeRasterOutcome {
  admission: NativeRasterAdmission;
  rendered: boolean;
  width: number;
  height: number;
  drawCalls: number;
  sampleCount: number;
  lowerMs: number;
  encodeMs: number;
  transferMs: number;
  straightenMs: number;
  /** Byte length of the pixel payload. */
  pixelBytes: number;
  /**
   * Straight-alpha RGBA8, `width * height * 4` bytes when `rendered` is true,
   * otherwise empty.
   */
  pixels: Uint8Array;
}

/** Little-endian `u32` header length; must match `native_raster.rs`. */
const HEADER_PREFIX_BYTES = 4;

/**
 * Decode the framed raw response from `native_raster_frame`.
 *
 * The command returns `[u32 LE header length][header JSON][pixels]` as raw
 * bytes rather than a JSON body, because a JSON array of six million numbers is
 * roughly four times the size of the frame and costs a parse pass on top of the
 * transport. Tauri delivers raw bodies as an `ArrayBuffer`.
 */
export function decodeRasterResponse(body: ArrayBuffer): NativeRasterOutcome {
  if (body.byteLength < HEADER_PREFIX_BYTES) {
    throw new Error('native raster response was shorter than its header prefix');
  }
  const bytes = new Uint8Array(body);
  const view = new DataView(body);
  const headerLength = view.getUint32(0, true);
  const pixelStart = HEADER_PREFIX_BYTES + headerLength;
  if (headerLength === 0 || pixelStart > body.byteLength) {
    throw new Error('native raster response header length was out of range');
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(HEADER_PREFIX_BYTES, pixelStart)),
  ) as Omit<NativeRasterOutcome, 'pixels'>;
  const pixels = bytes.subarray(pixelStart);
  if (pixels.length !== header.pixelBytes) {
    throw new Error(
      `native raster payload was ${pixels.length} bytes but the header declared ${header.pixelBytes}`,
    );
  }
  return { ...header, pixels };
}

interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function core(): TauriCore | null {
  const tauri = (globalThis as { __TAURI__?: { core?: TauriCore } }).__TAURI__;
  return tauri?.core ?? null;
}

/** True when the native raster commands are reachable at all. */
export function isNativeRasterAvailable(): boolean {
  return isTauriRuntime() && core() !== null;
}

/**
 * Capability and health. Never creates a device, so it is safe to call from the
 * diagnostics surface on any render.
 */
export async function nativeRasterStatus(): Promise<NativeRasterDiagnostics | null> {
  const invoke = core();
  if (!invoke) return null;
  try {
    return (await invoke.invoke('native_raster_status')) as NativeRasterDiagnostics;
  } catch {
    return null;
  }
}

/**
 * Lower the scene and report admission without touching the device.
 *
 * This is the call the renderer makes *before* deciding whether a native frame
 * is worth requesting: admission is pure computation over the IR (measured at
 * 0.31 ms for 600 items on the reference machine), while a real frame pays for
 * GPU submission and a full-frame readback.
 */
export async function nativeRasterPlan(input: {
  nodes: readonly unknown[];
  view: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
}): Promise<NativeRasterAdmission | null> {
  const invoke = core();
  if (!invoke) return null;
  try {
    const body = (await invoke.invoke('native_raster_frame', {
      request: {
        nodes: input.nodes,
        view: [...input.view],
        width: input.width,
        height: input.height,
        dryRun: true,
      },
    })) as ArrayBuffer;
    return decodeRasterResponse(body).admission;
  } catch {
    return null;
  }
}

/**
 * Rasterize one frame natively.
 *
 * Returns `null` when the native stage is unreachable, and an outcome with
 * `rendered: false` when the frame is not fully admitted. Both mean the same
 * thing to the caller: keep the authoritative Canvas2D replay. Neither is an
 * error path, and neither should be surfaced as a fault.
 */
export async function nativeRasterFrame(input: {
  nodes: readonly unknown[];
  view: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
}): Promise<NativeRasterOutcome | null> {
  const invoke = core();
  if (!invoke) return null;
  try {
    const body = (await invoke.invoke('native_raster_frame', {
      request: {
        nodes: input.nodes,
        view: [...input.view],
        width: input.width,
        height: input.height,
        dryRun: false,
      },
    })) as ArrayBuffer;
    return decodeRasterResponse(body);
  } catch {
    return null;
  }
}

/** Explicit re-detect / retry after a paused stage. */
export async function nativeRasterRetry(): Promise<boolean> {
  const invoke = core();
  if (!invoke) return false;
  try {
    await invoke.invoke('native_raster_retry');
    return true;
  } catch {
    return false;
  }
}

/** Human-readable, non-identifying summary of an admission report. */
export function describeAdmission(report: NativeRasterAdmission): string {
  if (report.rejected === 0) {
    return `${report.admitted} items admitted natively`;
  }
  const detail = Object.entries(report.reasons)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason} x${count}`)
    .join(', ');
  return `${report.admitted} of ${report.considered} items admitted natively (${detail})`;
}

/**
 * Whether a native frame is worth requesting at all.
 *
 * Two gates, both required:
 *  - the stage must be reachable and not paused, and
 *  - the frame must be fully admitted, because a partial plan is not a valid
 *    frame: a GPU-only surface cannot composite a Canvas2D island without a
 *    bridge that does not exist yet.
 *
 * Callers that only have the admission report (a dry run) pass it directly;
 * callers that already paid for a frame pass the outcome's report.
 */
export function shouldPresentNativeFrame(
  diagnostics: NativeRasterDiagnostics | null,
  report: NativeRasterAdmission | null,
): boolean {
  if (!diagnostics?.available) return false;
  if (diagnostics.health.paused) return false;
  if (!report) return false;
  return report.rejected === 0 && report.considered > 0;
}

/**
 * Wrap a straight-alpha RGBA8 buffer as `ImageData` for the present surface.
 *
 * `RasterizedFrame` is documented as straight alpha precisely so this is a
 * view, not a conversion: `ImageData` is also defined on straight alpha. A
 * premultiplied buffer here would darken every translucent pixel, which is why
 * the native stage un-premultiplies before returning.
 */
export function toImageData(outcome: NativeRasterOutcome): ImageData {
  const expected = outcome.width * outcome.height * 4;
  if (outcome.pixels.length !== expected) {
    throw new Error(
      `native raster returned ${outcome.pixels.length} bytes for ${outcome.width}x${outcome.height} (expected ${expected})`,
    );
  }
  // A fresh copy keeps the caller's view of the response buffer from aliasing
  // into a surface that outlives it.
  const clamped = new Uint8ClampedArray(outcome.pixels.byteLength);
  clamped.set(outcome.pixels);
  return new ImageData(clamped, outcome.width, outcome.height);
}
