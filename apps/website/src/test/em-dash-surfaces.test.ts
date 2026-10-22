import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const websiteSrc = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = path.resolve(websiteSrc, '../../..');

const SKIP_FILE_NAMES = new Set(['release-manifest.json', 'em-dash-surfaces.test.ts']);

const WEBSITE_WALK_ROOTS = [
  'apps/website/src/pages',
  'apps/website/src/components',
  'apps/website/src/layouts',
  'apps/website/src/data',
  'apps/website/src/lib',
] as const;

const APP_COPY_SURFACES = [
  'packages/editor/src/components/Upscale/UpscaleDialog.tsx',
  'packages/home/src/EmptyStates.tsx',
  'packages/home/src/NewDesignDialog.tsx',
  'packages/help/src/content/getting-started.ts',
  'packages/help/src/content/panels.ts',
  'packages/ui/src/components/ColorPicker/LabColorFields.tsx',
  'packages/ui/src/components/ColorPicker/LchColorFields.tsx',
  'apps/desktop/src/demo/demoSeo.ts',
  'apps/desktop/src/demo/sampleDocument.ts',
  'apps/desktop/src/demo/DemoBanner.tsx',
  'apps/desktop/src/App.tsx',
  'apps/desktop/public/varve-demo-sw.js',
  'packages/codegen/src/shared.ts',
  'packages/codegen/src/svg.ts',
  'packages/codegen/src/design-audit.ts',
  'packages/codegen/src/css-modules.ts',
  'packages/codegen/src/tailwind.ts',
] as const;

const CHANGELOG_REL = 'CHANGELOG.md';

/** Drop comments and style/script so remaining dashes are user-facing copy. */
function visibleSource(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[ \t])\/\/.*$/gm, '$1')
    .replace(/^\s*\*.*$/gm, '');
}

function walkFiles(relRoot: string, suffixes: readonly string[]): string[] {
  const abs = path.join(repoRoot, relRoot);
  const found: string[] = [];
  const stack = [abs];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (SKIP_FILE_NAMES.has(entry.name)) continue;
      if (entry.name.includes('.test.')) continue;
      if (!suffixes.some((suffix) => entry.name.endsWith(suffix))) continue;
      found.push(path.relative(repoRoot, next));
    }
  }
  return found.sort();
}

describe('rendered website and app copy', () => {
  it('has no user-facing em dash on website pages, components, layouts, or data', () => {
    const files = WEBSITE_WALK_ROOTS.flatMap((rel) =>
      walkFiles(rel, ['.astro', '.ts', '.tsx', '.js', '.json']),
    );
    expect(files.length).toBeGreaterThan(80);
    for (const rel of files) {
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      if (path.basename(rel) === 'screenshot-manifest.json') {
        const manifest = JSON.parse(source) as {
          scenes: Record<string, { caption?: string; alt?: string }>;
        };
        for (const [id, scene] of Object.entries(manifest.scenes)) {
          expect(scene.caption ?? '', `${rel} ${id} caption`).not.toMatch(/\u2014|&mdash;/);
          expect(scene.alt ?? '', `${rel} ${id} alt`).not.toMatch(/\u2014|&mdash;/);
        }
        continue;
      }
      expect(visibleSource(source), rel).not.toMatch(/\u2014|&mdash;/);
    }
  });

  it('has no em dash in changelog notes that the website renders', () => {
    const source = fs.readFileSync(path.join(repoRoot, CHANGELOG_REL), 'utf8');
    expect(source, CHANGELOG_REL).not.toMatch(/\u2014|&mdash;/);
  });

  it('has no user-facing em dash in app dialog, demo, help, and export copy', () => {
    for (const rel of APP_COPY_SURFACES) {
      const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      expect(visibleSource(source), rel).not.toMatch(/\u2014|&mdash;/);
    }
  });

  it('does not treat protocol or in-string slashes as comments', () => {
    expect(visibleSource('const url = "https://varve.studio/try";')).toContain(
      'https://varve.studio/try',
    );
    expect(visibleSource("const path = 'foo//bar';")).toContain('foo//bar');
    expect(visibleSource('  // hidden — comment\nvisible copy')).toContain('visible copy');
    expect(visibleSource('  // hidden — comment\nvisible copy')).not.toMatch(/\u2014/);
  });

  it('keeps a space on both sides of the hero eyebrow separator', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'apps/website/src/components/Hero.astro'),
      'utf8',
    );
    expect(source).toMatch(/hero-eyebrow-prefix">Local-first design suite &middot; <\/span>/);
  });
});
