import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide guard for bottom-anchored viewport chrome.
 *
 * Transient surfaces pinned to the viewport bottom (`position: fixed` plus a
 * `bottom` offset) — toasts, onboarding tips, the onboarding checklist, import
 * progress — share one inset recipe published by `.editor-shell`
 * (`--overlay-bottom-inset` / `--overlay-right-inset` / `--overlay-left-inset`
 * in `packages/editor/src/editor.css`).
 *
 * Why this exists. A bare `bottom: var(--space-4)` is wrong three ways: it sits
 * under the on-screen keyboard (which covers the layout viewport but not the
 * visual one), it sits under a standalone PWA's bottom gesture bar, and
 * `right: var(--space-4)` drops a right-anchored surface on top of the docked
 * Inspector rail. That last one was observed, not theorized: the "Did You Know?"
 * tip covered the Inspector's "Snap tolerance" field at 900px, which
 * `tests/e2e/responsive/dock-panels.spec.ts` reports as an unreachable control.
 * Four surfaces carried the same defect because each had re-derived its own
 * offset; the first test below makes a fifth copy impossible.
 *
 * Deliberate exceptions are listed in `BOTTOM_INSET_EXEMPTIONS` with a reason,
 * the same way `scripts/quality/audit-token-usage.mjs` records its documented
 * override hooks.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_ROOTS = ['packages/editor/src', 'packages/ui/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-pages', 'dist-try', '.worktrees', '.tmp']);

/** The shell owns the recipe; every other surface consumes it. */
const RECIPE_OWNER = 'packages/editor/src/editor.css';

/**
 * Blocks that are `position: fixed` with a `bottom` offset but are legitimately
 * exempt, keyed by repo-relative path with the selector prefix that is exempt.
 */
const BOTTOM_INSET_EXEMPTIONS: ReadonlyArray<{
  path: string;
  selectorIncludes: string;
  reason: string;
}> = [
  {
    path: 'packages/editor/src/components/Prototype/prototype.css',
    selectorIncludes: '.prototype-presenter__toolbar',
    reason:
      'The prototype presenter is a full-bleed presenting surface: the shell, its rails and the status bar are not rendered, so there is no rail to clear and no editor keyboard to inset for.',
  },
  {
    path: 'packages/editor/src/editor.css',
    selectorIncludes: '.editor__',
    reason:
      'Docked rail panels are positioned from the shell grid (bottom: 0 / var(--statusbar-height)) so they meet the grid rows exactly. They are grid-synced chrome, not viewport-anchored overlays, and adding the keyboard inset would double-count the status bar.',
  },
];

/** Properties that make an element viewport-anchored rather than in-flow. */
const FIXED = /\bfixed\b/;
/** Offsets that satisfy the contract: the shared token, or the raw inset. */
const SATISFIES = /var\(\s*--(?:overlay-bottom-inset|keyboard-inset-bottom)\b/;

interface Declaration {
  property: string;
  value: string;
}

interface Block {
  selector: string;
  atRules: string[];
  declarations: Declaration[];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const chunk of body.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator < 0) continue;
    const property = chunk.slice(0, separator).trim().toLowerCase();
    const value = chunk.slice(separator + 1).trim();
    if (property.length === 0 || value.length === 0) continue;
    declarations.push({ property, value });
  }
  return declarations;
}

/**
 * Split a stylesheet into style blocks, carrying the enclosing at-rule
 * preludes. Comments must be stripped first — a brace inside a comment would
 * otherwise be read as a block boundary.
 */
function parseBlocks(css: string, atRules: string[] = []): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  let selectorStart = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '{') {
      const selector = css.slice(selectorStart, index).trim();
      let depth = 1;
      let cursor = index + 1;
      while (cursor < css.length && depth > 0) {
        const inner = css[cursor];
        if (inner === '{') depth += 1;
        else if (inner === '}') depth -= 1;
        cursor += 1;
      }
      const body = css.slice(index + 1, cursor - 1);
      if (selector.startsWith('@')) {
        blocks.push(...parseBlocks(body, [...atRules, selector]));
      } else {
        blocks.push({ selector, atRules, declarations: parseDeclarations(body) });
      }
      index = cursor;
      selectorStart = index;
      continue;
    }
    if (character === '}') {
      index += 1;
      selectorStart = index;
      continue;
    }
    index += 1;
  }
  return blocks;
}

function collectCssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectCssFiles(path, out);
    else if (path.endsWith('.css')) out.push(path);
  }
  return out;
}

interface FixedBottomSurface {
  file: string;
  selector: string;
  bottom: string;
}

function findFixedBottomSurfaces(): FixedBottomSurface[] {
  const surfaces: FixedBottomSurface[] = [];
  for (const root of SCAN_ROOTS) {
    for (const absolute of collectCssFiles(join(ROOT, root))) {
      const file = relative(ROOT, absolute);
      for (const block of parseBlocks(stripComments(readFileSync(absolute, 'utf8')))) {
        const body = block.declarations;
        const isFixed = body.some(
          (declaration) => declaration.property === 'position' && FIXED.test(declaration.value),
        );
        if (!isFixed) continue;
        for (const declaration of body) {
          if (declaration.property !== 'bottom') continue;
          surfaces.push({ file, selector: block.selector, bottom: declaration.value });
        }
      }
    }
  }
  return surfaces;
}

function isExempt(surface: FixedBottomSurface): boolean {
  return BOTTOM_INSET_EXEMPTIONS.some(
    (exemption) =>
      exemption.path === surface.file && surface.selector.includes(exemption.selectorIncludes),
  );
}

describe('bottom-anchored viewport chrome', () => {
  const surfaces = findFixedBottomSurfaces();

  it('finds the surfaces it is supposed to guard', () => {
    // A discovery bug would silently turn this file into a no-op guard.
    expect(surfaces.length).toBeGreaterThanOrEqual(6);
    const files = new Set(surfaces.map((surface) => surface.file));
    expect(files.has(RECIPE_OWNER)).toBe(true);
  });

  it('every viewport-anchored bottom offset consumes the shared inset recipe', () => {
    const offenders = surfaces
      .filter((surface) => !isExempt(surface))
      .filter((surface) => !SATISFIES.test(surface.bottom))
      .map((surface) => `${surface.file} → ${surface.selector} { bottom: ${surface.bottom} }`);
    expect(
      offenders,
      `A viewport-fixed surface re-derived its own bottom offset. Consume ` +
        `var(--overlay-bottom-inset) (published by .editor-shell in ${RECIPE_OWNER}) so it clears the ` +
        `virtual keyboard, a standalone PWA's gesture bar and the status bar; or add a reasoned entry to ` +
        `BOTTOM_INSET_EXEMPTIONS.`,
    ).toEqual([]);
  });

  it('every exemption still names a selector that exists', () => {
    for (const exemption of BOTTOM_INSET_EXEMPTIONS) {
      const matched = surfaces.some(
        (surface) =>
          surface.file === exemption.path && surface.selector.includes(exemption.selectorIncludes),
      );
      expect(
        matched,
        `Exemption for ${exemption.path} (${exemption.selectorIncludes}) no longer matches anything — ` +
          `remove it rather than leaving a stale carve-out.`,
      ).toBe(true);
    }
  });

  it('publishes the recipe exactly once, from the shell', () => {
    const shell = stripComments(readFileSync(join(ROOT, RECIPE_OWNER), 'utf8'));
    const blocks = parseBlocks(shell).filter((block) => block.selector.includes('.editor-shell'));
    const declarations = blocks.flatMap((block) => block.declarations);

    const bottom = declarations.filter(
      (declaration) => declaration.property === '--overlay-bottom-inset',
    );
    expect(bottom, 'the shell must define --overlay-bottom-inset').toHaveLength(1);
    expect(bottom[0]!.value).toContain('--keyboard-inset-bottom');
    expect(bottom[0]!.value).toContain('safe-area-inset-bottom');
    // The status bar is bottom chrome with 24px targets of its own; a toast that
    // lands on it hides real controls. The canonical `.varve-toast-container`
    // clears it, so this recipe must too.
    expect(bottom[0]!.value).toContain('--statusbar-height');

    // Both side gutters must exist, and at least one rule must make them
    // rail-aware; otherwise a right-anchored surface sits on the Inspector.
    for (const token of ['--overlay-left-inset', '--overlay-right-inset']) {
      expect(
        declarations.some((declaration) => declaration.property === token),
        `the shell must define ${token}`,
      ).toBe(true);
    }
    const railAware = blocks.find(
      (block) =>
        block.atRules.some((atRule) => /min-width\s*:\s*900px/.test(atRule)) &&
        block.declarations.some(
          (declaration) =>
            declaration.property === '--overlay-right-inset' &&
            declaration.value.includes('--inspector-width'),
        ),
    );
    expect(
      railAware,
      'a min-width:900px rule must make --overlay-right-inset rail-aware, so a right-anchored ' +
        'surface cannot cover the docked Inspector',
    ).toBeDefined();
  });

  it('caps the rail gutters and subtracts both of them from a viewport-width bound', () => {
    const blocks = parseBlocks(stripComments(readFileSync(join(ROOT, RECIPE_OWNER), 'utf8')));

    // The rail-aware gutters must be capped by a viewport fraction. The tokens
    // are rem-derived *preferred* widths while the dock resolves the real rails
    // from ratios, so at an enlarged root text size the pair can demand more
    // than the whole viewport — which pushes a surface's available width
    // negative and drops it back onto its rem floor, over the opposite rail.
    const railAwareBlock = blocks.find(
      (block) =>
        block.atRules.some((atRule) => /min-width\s*:\s*900px/.test(atRule)) &&
        block.declarations.some((declaration) => declaration.property === '--overlay-left-inset'),
    );
    expect(railAwareBlock, 'the rail-aware tier must define --overlay-left-inset').toBeDefined();
    for (const token of ['--overlay-left-inset', '--overlay-right-inset']) {
      const declaration = railAwareBlock!.declarations.find(
        (candidate) => candidate.property === token,
      )!;
      expect(
        declaration.value,
        `${token} must be capped by a viewport fraction (min(…, Nvw)) so the two gutters ` +
          `cannot together exceed the viewport`,
      ).toMatch(/min\([\s\S]*\d+vw[\s\S]*\)/);
    }

    // Every width derived from the viewport must subtract *both* gutters.
    // Subtracting only the right one lets a right-anchored surface reach
    // straight across the left rail — the observed 900x800 @ 200% text failure,
    // where the tip covered the Layers rail's Design Canvas controls.
    const availableDeclarations = collectCssFiles(join(ROOT, 'packages/editor/src'))
      .flatMap((absolute) => parseBlocks(stripComments(readFileSync(absolute, 'utf8'))))
      .flatMap((block) => block.declarations)
      .filter((declaration) => /100vw/.test(declaration.value));
    expect(
      availableDeclarations.length,
      'no viewport-width bound was found — the scan is broken',
    ).toBeGreaterThan(0);
    const oneSided = availableDeclarations.filter(
      (declaration) =>
        declaration.value.includes('--overlay-right-inset') &&
        !declaration.value.includes('--overlay-left-inset'),
    );
    expect(
      oneSided.map((declaration) => `${declaration.property}: ${declaration.value}`),
      'a viewport-width bound subtracts only --overlay-right-inset; it must subtract both ' +
        'gutters, or the surface can cross the left rail',
    ).toEqual([]);
  });
});
