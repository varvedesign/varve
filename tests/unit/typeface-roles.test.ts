import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Interface chrome uses the interface face; reading text opts in to the
 * reading face (DESIGN.md § Typography: "assigned by role, never by surface").
 *
 * The 2026-10-21 shell audit counted 85 visible chrome text nodes in the
 * reading face against 31 in the interface face: `body` defaulted to
 * `--font-body`, so menus, popovers, panel titles, Inspector tabs and status
 * text inherited it while buttons (native-control reset) used the interface
 * face, mixing two faces inside one control row.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL = stripComments(
  readFileSync(join(ROOT, 'apps', 'desktop', 'src', 'global.css'), 'utf8'),
);
const EDITOR = stripComments(
  readFileSync(join(ROOT, 'packages', 'editor', 'src', 'editor.css'), 'utf8'),
);

function declarationsFor(selectorPattern: RegExp, css = GLOBAL): Map<string, string> {
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorPattern.test((block[1] ?? '').trim())) continue;
    const out = new Map<string, string>();
    for (const declaration of (block[2] ?? '').split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0) out.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
    }
    return out;
  }
  return new Map();
}

describe('application typeface roles', () => {
  it('defaults the document to the interface face', () => {
    expect(declarationsFor(/^body$/).get('font-family')).toBe('var(--font-interface)');
  });

  it('keeps paragraphs and tooltips in the reading face without raising specificity', () => {
    const prose = declarationsFor(/^:where\(/);
    expect(prose.get('font-family')).toBe('var(--type-content-body-family)');
    const selector = [...GLOBAL.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .map((m) => (m[1] ?? '').trim())
      .find((s) => s.startsWith(':where('));
    expect(selector).toMatch(/\bp\b/);
    expect(selector).toMatch(/\.varve-tooltip__body\b/);
  });

  // The editor shell and its menubar dropdowns restated the reading face on
  // their own roots, which overrode the document default for every editor
  // descendant.
  it('does not put editor chrome containers back in the reading face', () => {
    for (const container of [
      /^\.editor-shell$/,
      /^\.editor-menubar__menu$/,
      /^\.editor-menubar__submenu$/,
    ]) {
      const family = declarationsFor(container, EDITOR).get('font-family');
      expect(family, String(container)).not.toBe('var(--font-body)');
    }
  });
});
