/** Public hosted GoatCounter account used by varve.studio and /try. */
export const VARVE_GOATCOUNTER_DOMAIN = 'varvestudio.goatcounter.com';

/** Public collector hostname only. Never accept a URL, credential or arbitrary host. */
export function safeGoatCounterDomain(domain: string): string | null {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.goatcounter\.com$/.test(domain) ? domain : null;
}

/** Drop credentials, path, query and fragment; same-site navigation isn't acquisition. */
export function websiteReferrer(referrer: string, origin: string): string {
  try {
    const url = new URL(referrer);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin === origin) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * First-party channel tags we put on our own links (`?ref=masto-p1`).
 * Tags are `prefix-suffix`; the suffix may itself contain hyphens
 * (`reddit-graphic-design`, `li-s8`). Unknown `ref` values are dropped.
 */
export const WEBSITE_CAMPAIGN_REF =
  /^(masto|bsky|yt|reddit|hn|ph|uneed|saashub|x|ig|threads|discord|lnl|press|email|aur|flathub|winget|gh-readme|release-notes|footer|download|header|try|home|li|lemmy|nl|prompt|sample|gallery|answer)-[a-z0-9-]{1,24}$/;

/** Keep only an allowlisted `ref` campaign tag; drop every other query param. */
export function websiteCampaignRef(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const ref = params.get('ref');
  return ref && WEBSITE_CAMPAIGN_REF.test(ref) ? ref : null;
}

/** GoatCounter campaign via documented `path?ref=` (pixel `/count` splits query from `p`). */
export function pathWithCampaign(path: string, search: string): string {
  const ref = websiteCampaignRef(search);
  return ref ? `${path}?ref=${ref}` : path;
}
