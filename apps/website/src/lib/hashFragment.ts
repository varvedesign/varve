/**
 * Fragment helpers shared by the surfaces that reveal a panel from a deep link.
 *
 * A fragment is attacker-agnostic but not always well formed: `#100%`,
 * `#a%zz` and a bare `#%` all reach `decodeURIComponent` as-is, and it throws
 * `URIError` on them. That throw used to happen in the middle of a page's
 * bootstrap script, which meant the rest of the script (tab activation,
 * recommendation banner, `hashchange` registration) never ran for that visit.
 *
 * Decoding still has to happen — slugs may contain non-ASCII letters, and
 * `location.hash` is percent-encoded — so it happens here, once, guarded.
 */

/** Decode a fragment or hash to an element id. Returns '' when it cannot. */
export function decodeHashId(hash: string | null | undefined): string {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape is not a reason to break page bootstrap. It cannot
    // name a real id anyway, and callers treat '' as "no fragment".
    return '';
  }
}
