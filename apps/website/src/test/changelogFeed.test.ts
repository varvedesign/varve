import { describe, expect, it } from 'vitest';
import { parseChangelogFile } from '../lib/changelog';
import { buildChangelogFeed } from '../lib/changelogFeed';

/**
 * Changelog feed guards.
 *
 * /changelog.xml must stay a usable RSS 2.0 document: one item per dated
 * release, canonical absolute links, no undated Unreleased section, and no
 * raw XML metacharacters in rendered text. Its exclusion from the sitemap
 * and search index is structural (an .xml endpoint is neither an .astro page
 * nor .html output), so nothing here needs to assert it.
 */

const xml = buildChangelogFeed();
const dated = parseChangelogFile().filter((release) => !release.isUnreleased && release.date);
const latest = dated[0];

describe('changelog RSS feed', () => {
  it('is an RSS 2.0 document with a channel self link', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<title>Varve changelog</title>');
    expect(xml).toContain('rel="self" type="application/rss+xml"');
    expect(xml.trimEnd().endsWith('</rss>')).toBe(true);
  });

  it('emits one item per dated release, newest first', () => {
    expect(dated.length).toBeGreaterThan(0);
    expect([...xml.matchAll(/<item>/g)].length).toBe(Math.min(dated.length, 20));
    expect(xml).toContain(`<title>Varve ${latest!.version}</title>`);
    expect(xml).not.toContain('<title>Varve Unreleased</title>');
  });

  it('links every entry to an absolute changelog anchor with a guid', () => {
    const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.startsWith('https://varve.studio/changelog')).toBe(true);
    }
    expect(xml).toContain(`isPermaLink="true">https://varve.studio/changelog#v${latest!.version}<`);
    expect(xml).toContain('<pubDate>');
  });

  it('escapes XML metacharacters in rendered text', () => {
    // Every text field goes through escapeXml, so the only ampersands left
    // must be the five named entities (or numeric references).
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/);
    const descriptions = [...xml.matchAll(/<description>([\s\S]*?)<\/description>/g)];
    expect(descriptions.length).toBeGreaterThan(0);
    for (const match of descriptions) {
      expect(match[1]).not.toMatch(/[<>]/);
    }
  });
});
