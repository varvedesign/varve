import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const websiteSrc = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = path.resolve(websiteSrc, '../../..');

const SURFACES = [
  'apps/website/src/pages/index.astro',
  'apps/website/src/pages/download.astro',
  'apps/website/src/components/Hero.astro',
  'apps/website/src/components/ClosingCTA.astro',
  'apps/website/src/components/TrustStrip.astro',
  'apps/website/src/components/ProductShowcase.astro',
  'apps/website/src/components/DisciplineTabs.astro',
  'apps/website/src/components/ScreenshotZoom.astro',
  'apps/website/src/layouts/Layout.astro',
  'apps/desktop/src/demo/DemoBanner.tsx',
] as const;

/** Captions and alts ProductShowcase actually interpolates on the homepage. */
const HOMEPAGE_SHOWCASE_SCENES = [
  'workspace',
  'workspace-dark',
  'vector',
  'typography',
  'workspace-shared-workflows',
  'tablet-workspace',
] as const;

/** Drop comments and style/script so remaining dashes are user-facing copy. */
function visibleSource(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

describe('home, download, and demo-banner copy', () => {
  it('has no user-facing em dash', () => {
    for (const rel of SURFACES) {
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      const visible = visibleSource(source);
      expect(visible, rel).not.toMatch(/\u2014|&mdash;/);
    }
  });

  it('keeps a space on both sides of the hero eyebrow separator', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'apps/website/src/components/Hero.astro'),
      'utf8',
    );
    expect(source).toMatch(/hero-eyebrow-prefix">Local-first design suite &middot; <\/span>/);
  });

  it('has no em dash in homepage ProductShowcase captions or alts', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'apps/website/src/data/screenshot-manifest.json'),
        'utf8',
      ),
    ) as { scenes: Record<string, { caption?: string; alt?: string }> };
    for (const id of HOMEPAGE_SHOWCASE_SCENES) {
      const scene = manifest.scenes[id];
      expect(scene, id).toBeDefined();
      expect(scene.caption ?? '', `${id} caption`).not.toMatch(/\u2014|&mdash;/);
      expect(scene.alt ?? '', `${id} alt`).not.toMatch(/\u2014|&mdash;/);
    }
  });
});
