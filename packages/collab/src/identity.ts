/**
 * Collab identity model (ADR-0200 D1, security boundaries).
 *
 * Three distinct identities, deliberately not interchangeable:
 * - `deviceId`  — stable per app install (localStorage). Never sent as
 *                 proof of anything; allows the host to recognize returning
 *                 color assignments for friendliness only.
 * - `clientId`  — per browser tab / window session (fresh each join).
 *                 Deduplicates duplicate joins from the same tab.
 * - `actorId`   — assigned by the host at join; the authorship identity
 *                 stamped on operations. It is NOT a verified user account:
 *                 display names are cosmetic, authorization lives entirely
 *                 in the invite token the host validates.
 */

/** Mint a random UUID via the platform CSPRNG (throws in insecure contexts). */
export function mintClientId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('collab requires a secure context with crypto.randomUUID');
  }
  return crypto.randomUUID();
}

const DEVICE_ID_KEY = 'varve-collab-device-id';

/**
 * Stable per-install device id. Best-effort: when storage is unavailable
 * (private mode, SSR) a fresh ephemeral id is returned instead of throwing.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const minted = mintClientId();
    localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    return mintClientId();
  }
}

export function forgetDeviceId(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

/**
 * Deterministically map an actor id onto the 8-slot participant palette so
 * reconnecting participants keep their color without a central allocator
 * (the host assigns the canonical index in `welcome`; this fallback is used
 * before the welcome arrives or for local previews).
 */
export function fallbackColorIndex(actorId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < actorId.length; i++) {
    hash ^= actorId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 8;
}
