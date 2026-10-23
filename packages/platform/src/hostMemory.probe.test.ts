import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The probe is the only code that talks to the host. Without these tests the
 * budget can silently fall back to the 400 MB floor — the defect this module
 * exists to prevent — because every other suite injects a gate directly.
 */

const GIB = 1024 * 1024 * 1024;

const tauriRuntime = vi.hoisted(() => ({ value: false }));

vi.mock('./runtime', () => ({
  isTauriRuntime: () => tauriRuntime.value,
}));

import { probeHostMemory } from './hostMemory';

function installTauri(invoke: unknown): void {
  (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
  };
}

function clearTauri(): void {
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, '__TAURI__');
}

function setDeviceMemory(value: number | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'deviceMemory');
    return;
  }
  Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value });
}

describe('probeHostMemory', () => {
  afterEach(() => {
    tauriRuntime.value = false;
    clearTauri();
    setDeviceMemory(undefined);
  });

  it('reads measured headroom from the desktop host', async () => {
    tauriRuntime.value = true;
    const invoke = vi.fn(async () => ({ availableBytes: 5 * GIB, resourceTier: 'standard' }));
    installTauri(invoke);

    await expect(probeHostMemory()).resolves.toEqual({
      availableBytes: 5 * GIB,
      source: 'native',
    });
    expect(invoke).toHaveBeenCalledWith('host_memory_status');
  });

  it('treats the device-memory hint as usable headroom, not total capacity', async () => {
    setDeviceMemory(8);
    await expect(probeHostMemory()).resolves.toEqual({
      availableBytes: 4 * GIB,
      source: 'device-memory',
    });
  });

  it('reports unavailable when the host offers nothing, never unlimited', async () => {
    await expect(probeHostMemory()).resolves.toEqual({
      availableBytes: null,
      source: 'unavailable',
    });
  });

  it('degrades to the device hint when the desktop command fails', async () => {
    tauriRuntime.value = true;
    installTauri(async () => {
      throw new Error('ipc closed');
    });
    setDeviceMemory(4);

    await expect(probeHostMemory()).resolves.toEqual({
      availableBytes: 2 * GIB,
      source: 'device-memory',
    });
  });

  it('ignores a malformed native payload instead of trusting it', async () => {
    tauriRuntime.value = true;
    installTauri(async () => ({ availableBytes: -1 }));

    await expect(probeHostMemory()).resolves.toEqual({
      availableBytes: null,
      source: 'unavailable',
    });
  });
});
