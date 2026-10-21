#!/usr/bin/env node
/**
 * Shared published-app version for website copy (llms.txt, homepage "latest").
 *
 * Root package.json is the version source. The release date comes from the
 * matching `## [version] - YYYY-MM-DD` heading in CHANGELOG.md when present.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readAppVersion(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = typeof pkg.version === 'string' ? pkg.version : '';
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`root package.json version '${version}' is not a release version`);
  }
  return version;
}

export function readChangelogDate(version, root = repoRoot) {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = changelog.match(new RegExp(`^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})`, 'm'));
  return match?.[1] ?? null;
}

export function readPublishedApp(root = repoRoot) {
  const version = readAppVersion(root);
  return {
    version,
    releaseDate: readChangelogDate(version, root),
    repoUrl: 'https://github.com/varvedesign/varve',
    releaseUrl: `https://github.com/varvedesign/varve/releases/tag/v${version}`,
  };
}
