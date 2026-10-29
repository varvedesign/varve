# Analytics measurement plan and data inventory

The desktop app sends no usage stats. The production website and the `/try`
browser demo use GoatCounter only after the visitor clicks Allow. Local and
unconfigured website builds remain network-silent. This document describes the
permitted contract and the data transmitted by that consent-gated collector.
There is no remote analytics script; Varve emits only the events listed below.

| Question | Metric / event | Fields | Category | Status | Decision |
|---|---|---|---|---|---|
| Which pages help visitors reach a useful destination? | `website_page_viewed` | normalized route | Website | ACTIVE | Improve navigation and documentation |
| Which release/platform downloads matter? | `website_download_started` | release, platform, architecture, package type, release channel | Website | ACTIVE | Prioritize packaging and release support |
| Do website clicks open the browser demo? | `browser_demo_launched` (`demo-launch-website`) | entry source | Website | ACTIVE | Measure site-to-demo clicks |
| Do people open `/try` directly? | `demo-launch-direct` plus `try` / `try?ref=` | allowlisted campaign tag only | Website | ACTIVE | Measure demo visits and first-party campaign tags |
| Which demo export formats are used? | `demo-export-<format>` | png, jpeg, webp, or svg | Website | ACTIVE | See whether the demo is used to save work |
| Do demo visitors click Download desktop? | `demo-download-click` | none | Website | ACTIVE | Measure demo-to-download interest |
| Do community links help? | `website_outbound_clicked` | destination category | Website | SCHEMA ONLY | Not sent by the current provider |
| Which contact channels are used? | `website_contact_clicked` | channel category | Website | SCHEMA ONLY | Not sent by the current provider |

Desktop product-usage events (`app_launched`, `document_created`,
`feature_used`, `export_completed`, `export_failed`, `renderer_fallback`) remain
in the shared schema for leftover call sites. Release desktop builds use a
no-op provider and send none of them.

## Explicitly prohibited data

The analytics boundary rejects filenames, paths, document/project/layer/page/
component names, design text, comments, clipboard data, document contents,
canvas pixels, screenshots, exports, imported metadata, EXIF, image hashes,
geometry, generated code, prompts, arbitrary URLs and query strings, raw
error messages/stacks, email addresses, usernames, tokens, cookies,
authorization values, machine/host/device identifiers, authentication IDs,
advertising IDs, and arbitrary unknown fields.

## Consent and retention

Missing or corrupt consent is `unknown` and sends nothing. Website and `/try`
share `varve:website-analytics-consent:goatcounter-v1`. Revocation removes
pending events in that category. The client queue is bounded in memory and is
discarded on process shutdown; it has no disk persistence. Crash-report
retention remains governed by `docs/privacy/retention.md` and is independent of
this inventory.

## Data governance

- **Retention**: client retains nothing. GoatCounter retains aggregate counts
  under the configured account policy.
- **Access**: owner + one reviewer only; re-verified quarterly.
- **Deletion / export**: export before any account change; deletion is account
  termination plus a provider deletion request.
- **Provider settings**: Sessions and Individual pageviews disabled, no remote
  script, query strings limited to an allowlisted first-party `ref` tag,
  DNT and GPC honored.

## Search Console and Bing Webmaster Tools

Manual setup steps (owner only):

### Google Search Console
1. Go to https://search.google.com/search-console.
2. Add property: **Domain** type `varve.studio` (DNS verification) or
   **URL prefix** `https://varve.studio/`.
3. DNS verification: add the TXT record Google provides to the DNS zone for
   `varve.studio` (GitHub Pages domain).
4. Submit sitemap: `https://varve.studio/sitemap.xml`.
5. Monitor Coverage, Performance, and Core Web Vitals weekly.

### Bing Webmaster Tools
1. Go to https://www.bing.com/webmasters.
2. Add site: `https://varve.studio/`.
3. Verification: DNS CNAME record or HTML meta tag (GitHub Pages: meta tag).
4. Submit sitemap: `https://varve.studio/sitemap.xml`.
5. Monitor traffic and crawl health monthly.

### Canonical and structured data
- Canonical URL is set in `Layout.astro` via `<link rel="canonical">`.
- `sitemap.xml` is auto-generated from `.astro` pages plus the `/try` demo
  route (added manually since it is a separate Vite build).
- `robots.txt` allows all crawlers and points to the sitemap.
- Structured data (ContactPage, FAQPage) is on `contact.astro`.

## Legal and operational note

Technical controls do not determine the legal basis for a deployment. Before
enabling a real provider, Varve maintainers must confirm the actual user
jurisdictions, provider terms/DPA, data residency, retention, access controls,
deletion workflow, and applicable GDPR/ePrivacy, UK, Canadian, and
CCPA/CPRA requirements with qualified legal advice where needed.
