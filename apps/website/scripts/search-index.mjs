#!/usr/bin/env node
/**
 * Build-time search index and heading-anchor generator.
 *
 * Runs from `astro:build:done` (see astro.config.mjs) so both website build
 * variants — the custom-domain build and the GitHub Pages project build —
 * produce the same artifacts:
 *
 *   - `search-index.json` at the output root, consumed lazily by
 *     SearchDialog.astro;
 *   - stable `id` attributes on every `h2`/`h3` inside `<main>`, so result
 *     links can target the matching section and users can share section URLs.
 *
 * Implementation notes:
 *   - The pure string work lives in `src/lib/search/extract.ts` and is
 *     unit-tested; this file only walks the output directory.
 *   - No new dependency: Pagefind and similar indexers are excellent, but
 *     they need `wasm-unsafe-eval` and `worker-src blob:` in the CSP. The
 *     site ships a strict `script-src 'self'` policy (see Layout.astro), and
 *     weakening it for a hundred static pages is not a good trade. See
 *     docs/audits/website-search-and-section-links-2026-09-14.md.
 *   - A build with fewer than MINIMUM_PAGES indexed pages fails: a silently
 *     empty search is worse than a failed deploy.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { extractPage, findUndecodedEntities } from '../src/lib/search/extract.ts';
import { SEARCH_INDEX_VERSION } from '../src/lib/search/types.ts';

const MINIMUM_PAGES = 5;

/**
 * Payload budget for `search-index.json`, measured gzipped because every host
 * that serves this site compresses JSON and the file is fetched whole before the
 * first result can render.
 *
 * The target is 150 KB gzip (search feels immediate); 300 KB is the point where
 * a noticeable share of readers abandon the box (see
 * `docs/audits/website-audit-2026-10-22.md`). Crossing the target warns so drift
 * is visible in build logs; crossing the hard limit fails the build rather than
 * shipping a search box that takes seconds to answer.
 */
const INDEX_BUDGET_GZIP = 150 * 1024;
const INDEX_HARD_LIMIT_GZIP = 300 * 1024;
const IGNORED_TOP_LEVEL = new Set(['.well-known', '_astro']);

async function collectHtmlFiles(directory, root = directory, out = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === root && IGNORED_TOP_LEVEL.has(entry.name)) continue;
      await collectHtmlFiles(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/** `index.html` -> `/`; `docs/getting-started/index.html` -> `/docs/getting-started`. */
export function routeForFile(file, root) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'/index.html'.length)}`;
  return `/${relative.replace(/\.html$/, '')}`;
}

export function withBase(route, base) {
  const prefix = (base ?? '/').replace(/\/+$/, '');
  if (route === '/') return prefix === '' ? '/' : prefix;
  return `${prefix}${route}`;
}

/**
 * @param {{ dir: string, base?: string, log?: (message: string) => void }} options
 * @returns {Promise<{ pages: number, headingIds: number, bytes: number }>}
 */
export async function buildSearchIndex({ dir, base = '/', log = () => {} }) {
  const files = (await collectHtmlFiles(dir)).sort();
  const pages = [];
  let headingIds = 0;

  for (const file of files) {
    const route = routeForFile(file, dir);
    if (route === '/404') continue;
    const html = await readFile(file, 'utf8');
    if (/<meta\b[^>]*name\s*=\s*"robots"[^>]*noindex/i.test(html)) continue;
    const extracted = extractPage(html, withBase(route, base));
    if (!extracted) continue;
    if (extracted.html !== html) {
      await writeFile(file, extracted.html);
      headingIds += extracted.page.sections.filter((section) => section.anchor).length;
    }
    if (extracted.page.title === '' && extracted.page.sections.length === 0) continue;
    pages.push(extracted.page);
  }

  pages.sort((a, b) => a.url.localeCompare(b.url));
  // Runs on the indexed (capped) section text on purpose: the point is to catch
  // an undecoded entity that reached the search index, not to validate markup.
  const leftover = new Set();
  for (const page of pages) {
    for (const section of page.sections) {
      for (const entity of findUndecodedEntities(`${section.heading} ${section.text}`)) {
        leftover.add(entity);
      }
    }
  }
  if (leftover.size > 0) {
    log(`WARNING: undecoded entities in search text: ${[...leftover].join(', ')}`);
  }
  const index = { version: SEARCH_INDEX_VERSION, pages };
  const serialized = JSON.stringify(index);
  const gzipBytes = gzipSync(Buffer.from(serialized), { level: 9 }).length;
  if (pages.length < MINIMUM_PAGES) {
    throw new Error(
      `search index build produced ${pages.length} pages (minimum ${MINIMUM_PAGES}); refusing to ship an empty index`,
    );
  }
  if (gzipBytes > INDEX_HARD_LIMIT_GZIP) {
    throw new Error(
      `search index is ${Math.round(gzipBytes / 1024)}KB gzipped (hard limit ${Math.round(INDEX_HARD_LIMIT_GZIP / 1024)}KB); ` +
        'it is fetched whole before the first result renders — raise MAX_SECTION_TEXT pressure, not this limit',
    );
  }
  if (gzipBytes > INDEX_BUDGET_GZIP) {
    log(
      `WARNING: search index is ${Math.round(gzipBytes / 1024)}KB gzipped ` +
        `(target ${Math.round(INDEX_BUDGET_GZIP / 1024)}KB) — see docs/audits/website-audit-2026-10-22.md`,
    );
  }
  await writeFile(path.join(dir, 'search-index.json'), serialized);
  log(
    `search index: ${pages.length} pages, ${headingIds} heading anchors, ` +
      `${serialized.length} bytes raw / ${Math.round(gzipBytes / 1024)}KB gzipped`,
  );
  return { pages: pages.length, headingIds, bytes: serialized.length };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const [dir, base = '/'] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/search-index.mjs <dist-dir> [base]');
    process.exit(2);
  }
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(2);
  }
  await buildSearchIndex({ dir, base, log: (message) => console.log(message) });
}
