import type { APIRoute } from 'astro';
import { buildChangelogFeed } from '../lib/changelogFeed';

/**
 * /changelog.xml — RSS 2.0 changelog feed. A thin endpoint over
 * lib/changelogFeed.ts; discovery and index-exclusion are documented there.
 */
export const GET: APIRoute = () =>
  new Response(buildChangelogFeed(), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
