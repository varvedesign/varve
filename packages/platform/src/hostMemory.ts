/**
 * Host memory evidence for the shared derived-work byte ledger.
 *
 * The ledger in `derivedWorkAdmission.ts` needs one number: how many bytes of
 * tracked local work this process may reserve at once. That number must come
 * from the host, because a fixed constant is simultaneously too small for a
 * workstation and too large for a 2 GB Chromebook.
 *
 * Evidence order:
 *
 * 1. **Measured (desktop).** The Tauri host reads `MemAvailable`/cgroup
 *    headroom (or the platform equivalent) and returns it over IPC. This is
 *    the only source that is both accurate and available on WebKitGTK, where
 *    `navigator.deviceMemory` is generally absent.
 * 2. **Device hint (web).** `navigator.deviceMemory` reports *total* device
 *    memory, quantized to a power of two and capped at 8 GB by Chromium. It is
 *    a coarse lower bound on capacity, not an availability measurement, so it
 *    is halved before use.
 * 3. **Nothing.** The ledger keeps its conservative 400 MB floor.
 *
 * The result is a *tracked reservation* ceiling, not a promise about RSS:
 * callers reserve conservative upper bounds (model arena + working frame), and
 * feature-level gates still make the per-operation fit decision against their
 * own measured peaks.
 */

import { isTauriRuntime } from './runtime';

export type HostMemorySource = 'native' | 'device-memory' | 'unavailable';

export interface HostMemorySnapshot {
  /** Bytes believed available to this process right now, or null if unknown. */
  readonly availableBytes: number | null;
  readonly source: HostMemorySource;
}

/** Headroom the ledger must leave for the rest of the app and the OS. */
export const DERIVED_WORK_HOST_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Largest tracked reservation the ledger will ever grant. Reservations are
 * deliberately conservative, so this cap only exists to keep an absurd host
 * value from disabling the ceiling entirely.
 */
export const DERIVED_WORK_MAX_TRACKED_BYTES = 16 * 1024 * 1024 * 1024;

/** Lowest ceiling; identical to the historical unknown/4 GB conservative floor. */
export const DERIVED_WORK_MIN_TRACKED_BYTES = 400_000_000;

/** Fraction of a coarse device-memory hint treated as usable headroom. */
const DEVICE_MEMORY_USABLE_FRACTION = 0.5;

function toPositiveBytes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const bytes = Math.floor(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/**
 * Derive the tracked reservation ceiling from a measured available-bytes
 * figure. Pure, so the policy is testable and both hosts cannot disagree.
 */
export function deriveDerivedWorkBudgetBytes(availableBytes: number | null): number {
  const available = toPositiveBytes(availableBytes);
  if (available === null) return DERIVED_WORK_MIN_TRACKED_BYTES;
  const headroom = available - DERIVED_WORK_HOST_RESERVE_BYTES;
  return Math.min(
    DERIVED_WORK_MAX_TRACKED_BYTES,
    Math.max(DERIVED_WORK_MIN_TRACKED_BYTES, Math.floor(headroom)),
  );
}

function readDeviceMemoryBytes(): number | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const deviceMemory = (navigator as unknown as { deviceMemory?: unknown }).deviceMemory;
    const totalBytes = toPositiveBytes(deviceMemory);
    if (totalBytes === null) return null;
    // `deviceMemory` is expressed in GiB.
    return Math.floor(totalBytes * 1024 * 1024 * 1024 * DEVICE_MEMORY_USABLE_FRACTION);
  } catch {
    return null;
  }
}

interface TauriCoreShape {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Resolve the Tauri core bridge from the global injection.
 *
 * `@varve/platform` deliberately has no `@tauri-apps/api` dependency (it is the
 * bundle's lowest layer), so this uses the same `window.__TAURI__.core` bridge
 * as `tauri.ts`. That bridge exists because the app config sets
 * `withGlobalTauri: true`; if that is ever turned off, every Tauri call in this
 * package must move to the imported API at the same time, or this probe reports
 * `unavailable` and the ledger falls back to its 400 MB floor.
 */
function tauriCore(): TauriCoreShape | null {
  // `globalThis` keeps the probe testable outside a DOM and matches `tauri.ts`.
  const host = (typeof window !== 'undefined' ? window : globalThis) as
    | { __TAURI__?: { core?: TauriCoreShape } }
    | undefined;
  return host?.__TAURI__?.core ?? null;
}

/** Read the desktop host's measured headroom. Returns null off-desktop or on failure. */
async function readNativeAvailableBytes(): Promise<number | null> {
  if (!isTauriRuntime()) return null;
  const core = tauriCore();
  if (!core) return null;
  try {
    const status = (await core.invoke('host_memory_status')) as
      | { availableBytes?: number | null }
      | null
      | undefined;
    return toPositiveBytes(status?.availableBytes);
  } catch {
    return null;
  }
}

/**
 * Probe host memory once. Never throws: an unmeasurable host is a supported
 * state that resolves to the conservative floor rather than to "unlimited".
 */
export async function probeHostMemory(): Promise<HostMemorySnapshot> {
  const native = await readNativeAvailableBytes();
  if (native !== null) return { availableBytes: native, source: 'native' };
  const device = readDeviceMemoryBytes();
  if (device !== null) return { availableBytes: device, source: 'device-memory' };
  return { availableBytes: null, source: 'unavailable' };
}
