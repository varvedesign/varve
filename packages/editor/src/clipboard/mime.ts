/** Clipping MIME types, payload format/version identifiers, and transport bounds. */

export const VARVE_MIME = 'application/vnd.varve+json';
export const LEGACY_MIME = 'application/vnd.strata+json';
/**
 * Chromium refuses a ClipboardItem containing any non-standard MIME type
 * unless it carries the `web ` prefix, and rejects the *whole* write if one
 * entry is invalid. So the unprefixed item below always threw there, dropping
 * copy into the text-only fallback — which writes node names, not nodes. Copy
 * appeared to work and paste silently did nothing.
 *
 * The prefixed write is attempted first and the unprefixed one kept as a
 * fallback: WebKitGTK, where the desktop app runs, accepts the plain type and
 * is not guaranteed to accept the prefixed one.
 */
export const WEB_VARVE_MIME = `web ${VARVE_MIME}`;
export const WEB_LEGACY_MIME = `web ${LEGACY_MIME}`;
export const VARVE_CLIPBOARD_FORMAT = 'varve-clipboard';
/** Versions 1–4 remain readable; v4 adds patterns and v5 adds page provenance. */
export const VARVE_CLIPBOARD_VERSION = 5 as const;
export const LEGACY_CLIPBOARD_VERSION = 1 as const;
export const MAX_CLIPBOARD_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_CLIPBOARD_NODES = 100_000;
export const MAX_CLIPBOARD_DEPTH = 256;
export const MAX_CLIPBOARD_FONT_DEPENDENCIES = 256;
export const MAX_CLIPBOARD_FONT_BYTES = 32 * 1024 * 1024;
/** Every type a Varve payload may arrive under, prefixed or not. */
export function isVarvePayloadType(type: string): boolean {
  return (
    type === VARVE_MIME ||
    type === LEGACY_MIME ||
    type === WEB_VARVE_MIME ||
    type === WEB_LEGACY_MIME
  );
}
