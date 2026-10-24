/**
 * Resolve the SHA-256 the downloader actually verifies.
 *
 * Catalog and manifest JSON have used both `checksum` and `sha256` for the
 * same digest. DownloadManager historically read only `checksum`, so a file
 * that stored its hash under `sha256` was published without verification.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface IntegrityHashFields {
  checksum?: string | null;
  sha256?: string | null;
}

/** Lowercase 64-hex digest, or null when neither field is a usable hash. */
export function resolvedIntegrityHash(entry: IntegrityHashFields): string | null {
  const raw = entry.checksum || entry.sha256 || '';
  const hash = raw.toLowerCase();
  return SHA256_HEX.test(hash) ? hash : null;
}
