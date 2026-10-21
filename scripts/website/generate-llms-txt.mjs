#!/usr/bin/env node
/**
 * Generate apps/website/public/llms.txt from the published app version.
 *
 * Run automatically before the website build so crawlers cannot pick up a
 * stale version or a competitor comparison. Also writable on demand:
 *
 *   node scripts/website/generate-llms-txt.mjs
 *   node scripts/website/generate-llms-txt.mjs --check
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../is-main-module.mjs';
import { readPublishedApp } from './app-version.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildLlmsTxt(app = readPublishedApp()) {
  const { version, releaseDate, repoUrl, releaseUrl } = app;
  const published = releaseDate ? `Varve ${version} (${releaseDate})` : `Varve ${version}`;

  return `# Varve

> Varve is a free, local-first desktop design suite for vector graphics, page layout, typography, motion, prototyping, print production, and email. It runs on Linux, macOS, and Windows. No account is required. Source-available under FSL-1.1-MIT; each release converts to MIT after two years. Public beta.

## What Varve is

- One application and one document model for Design, Print, Draw, Photo, Motion, and Email workspaces.
- Local-first: no account or mandatory cloud sync. Core editing works offline. Model downloads, online font/icon search, user-configured providers, update checks, and usage events are separate network features. Nothing about you or your files is sent unless you say yes.
- Built in Rust and TypeScript. The Rust engine computes geometry, colour, print, and a compact render IR; the webview draws the canvas.
- Free Community Edition with no subscription and no feature lockouts.
- Source: ${repoUrl}

## Release status

- Status: public beta. The latest published application release is ${published}.
- Installers cover Linux (x86_64 and ARM64: AppImage, deb, rpm), macOS (Apple Silicon DMG), and Windows (x86_64 and ARM64 NSIS). Windows and macOS installers are not code-signed; the macOS DMG is not notarized.
- Download: https://varve.studio/download and ${releaseUrl}. Verify the checksum before running an installer.
- Document format (\`.varve\`) is versioned. Keep backups. Newer documents are not backward-compatible with older app versions.
- A separate \`varve-models-v1\` GitHub release holds on-device model artifacts, not an application installer.

## Key facts

- Export: SVG, RGB PDF, PDF/X-1a and PDF/X-4, PNG/WebP/JPEG, code (React, Flutter, SwiftUI, email HTML), and CSS/Lottie/SVG animation. Video export depends on the platform's WebCodecs support.
- Print: CMYK with ICC profiles, bleed, crop marks, and a preflight check. Multi-page booklet export is not shipped.
- AI features are on by default, run on your device with no Varve AI server, and can be turned off in Settings. Models download only when you ask.
- Collaboration is not implemented.
- Browser demo at https://varve.studio/try is a bounded sample-document preview, not a hosted replacement for the desktop app.

## FAQ

- Is Varve free? Yes. The Community Edition has no subscription and no feature lockouts.
- Does Varve work offline? Yes for core editing. Network features (model downloads, font search, update checks, usage events) each need your say-so.
- Is Varve open source? The source is publicly available under FSL-1.1-MIT, a source-available license that is not OSI-approved open source. After two years, each release converts to the MIT license.
- Can I use Varve for professional print work? It exports PDF/X-1a and PDF/X-4 with CMYK, marks, and preflight, but it is public beta. Test before critical production use.
- Has Varve shipped a release? Yes. The latest published application release is ${published}.

## Links

- Product: https://varve.studio/product
- Features: https://varve.studio/features
- Download: https://varve.studio/download
- Docs: https://varve.studio/docs
- How it is built: https://varve.studio/about/how-its-built
- License: https://varve.studio/about/license
- Source: ${repoUrl}
- Contact: https://varve.studio/contact
`;
}

export function writeLlmsTxt(root = repoRoot) {
  const app = readPublishedApp(root);
  const text = buildLlmsTxt(app);
  const destLlms = join(root, 'apps/website/public/llms.txt');
  const destVersion = join(root, 'apps/website/src/data/app-version.json');
  mkdirSync(dirname(destLlms), { recursive: true });
  mkdirSync(dirname(destVersion), { recursive: true });
  writeFileSync(destLlms, text);
  writeFileSync(destVersion, `${JSON.stringify(app, null, 2)}\n`);
  return { app, text, destLlms, destVersion };
}

export function llmsTxtIsCurrent(root = repoRoot) {
  const app = readPublishedApp(root);
  const expected = buildLlmsTxt(app);
  const actual = readFileSync(join(root, 'apps/website/public/llms.txt'), 'utf8');
  return { ok: actual === expected, expected, actual, app };
}

if (isMainModule(import.meta.url)) {
  const check = process.argv.includes('--check');
  if (check) {
    const result = llmsTxtIsCurrent();
    if (!result.ok) {
      process.stderr.write(
        'apps/website/public/llms.txt is stale. Run `node scripts/website/generate-llms-txt.mjs`.\n',
      );
      process.exit(1);
    }
    process.stdout.write(`llms.txt matches published Varve ${result.app.version}.\n`);
  } else {
    const { app } = writeLlmsTxt();
    process.stdout.write(`Wrote llms.txt for Varve ${app.version}.\n`);
  }
}
