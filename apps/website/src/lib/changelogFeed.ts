import { type ChangelogRelease, parseChangelogFile } from './changelog';
import { siteUrl } from './siteUrl';

/**
 * RSS 2.0 feed document for the Varve changelog.
 *
 * The route is /changelog.xml (src/pages/changelog.xml.ts), discovered through
 * the <link rel="alternate" type="application/rss+xml"> tag in Layout.astro.
 * Both build-time indexes stay out of it by construction: the sitemap
 * enumerates only .astro page files (see pages/sitemap.xml.ts) and the search
 * index walks only .html output (see scripts/search-index.mjs), so an .xml
 * endpoint can be neither sitemapped nor search-indexed.
 *
 * Items are the dated releases from CHANGELOG.md — the same parser the
 * changelog page renders — newest first, undated Unreleased sections omitted.
 * Absolute URLs come from siteUrl, so the feed follows SITE_URL/SITE_BASE
 * like every other link the site emits.
 */

const MAX_ITEMS = 20;
const MAX_DESCRIPTION_CHARS = 1200;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Entry HTML to plain text: keep link targets, drop tags, decode entities. */
function plainText(html: string): string {
  return html
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemDescription(release: ChangelogRelease): string {
  const sections = release.sections.map((section) => {
    const entries = section.entries
      .map((entry) => plainText(entry.html))
      .filter(Boolean)
      .join(' ');
    return `${section.category}: ${entries}`;
  });
  const text = sections.join(' ');
  return text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    : text;
}

function releaseDate(release: ChangelogRelease): Date | null {
  return release.date ? new Date(`${release.date}T00:00:00Z`) : null;
}

/** The full feed document. Exported so unit tests can assert on it directly. */
export function buildChangelogFeed(): string {
  const releases = parseChangelogFile()
    .filter((release) => !release.isUnreleased && releaseDate(release) !== null)
    .slice(0, MAX_ITEMS);

  const items = releases.map((release) => {
    const link = siteUrl(`/changelog#${release.anchor}`);
    const date = releaseDate(release);
    return [
      '    <item>',
      `      <title>${escapeXml(`Varve ${release.version}`)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      date ? `      <pubDate>${date.toUTCString()}</pubDate>` : null,
      `      <description>${escapeXml(itemDescription(release))}</description>`,
      '    </item>',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  });

  const latest = releases[0];
  const lastBuild = latest ? releaseDate(latest) : null;
  const channel = [
    '  <channel>',
    '    <title>Varve changelog</title>',
    `    <link>${escapeXml(siteUrl('/changelog'))}</link>`,
    '    <description>Release notes for Varve: features, fixes, and security updates in every published version.</description>',
    '    <language>en-us</language>',
    lastBuild ? `    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>` : null,
    `    <atom:link href="${escapeXml(siteUrl('/changelog.xml'))}" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    channel,
    '</rss>',
    '',
  ].join('\n');
}
