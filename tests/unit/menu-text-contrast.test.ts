import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Menu text must use text-safe colour tokens.
 *
 * The 2026-10-21 shell audit measured two AA failures in the editor context
 * menu (dark theme): the destructive "Delete" label at 3.63:1 because it was
 * painted with `--color-feedback-danger` (a non-text graphic token, guarded
 * only at 3:1), and the highlighted row's shortcut at 4.33:1 because it kept
 * `--color-text-muted` on the selected surface. `--color-text-danger` and
 * `--color-interactive-selected-foreground` are the tokens whose pairs
 * `audit:tokens` guards at AA on those surfaces.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = join(ROOT, 'packages', 'ui', 'src', 'components', 'components.css');

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

function rules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const block of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const declaration of (block[2] ?? '').split(';')) {
      const at = declaration.indexOf(':');
      if (at < 0) continue;
      declarations.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
    }
    out.push({
      selectors: (block[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
      declarations,
    });
  }
  return out;
}

/** The colour the last rule targeting exactly `selector` assigns. */
function colourFor(all: Rule[], selector: string): string | undefined {
  let colour: string | undefined;
  for (const rule of all) {
    if (rule.selectors.includes(selector) && rule.declarations.has('color')) {
      colour = rule.declarations.get('color');
    }
  }
  return colour;
}

describe('menu text contrast tokens', () => {
  const all = rules(readFileSync(COMPONENTS, 'utf8'));

  it('paints destructive labels with the text-safe danger token in every state', () => {
    for (const selector of [
      '.varve-menu__item--destructive',
      '.varve-menu__item--destructive:hover',
      '.varve-menu:not([data-input-modality="pointer"]) .varve-menu__item--destructive:focus-visible',
    ]) {
      expect(colourFor(all, selector), selector).toBe('var(--color-text-danger)');
    }
  });

  it('lets secondary text on a selected row take the selected foreground', () => {
    for (const row of [
      '.varve-menu:not([data-input-modality="pointer"]) .varve-menu__item:focus-visible',
      '.varve-menu__item[aria-checked="true"]',
      '.varve-menu__item[aria-expanded="true"]',
    ]) {
      for (const part of ['.varve-menu__shortcut', '.varve-menu__submenu-arrow']) {
        const selector = `${row} ${part}`;
        expect(colourFor(all, selector), selector).toBe('inherit');
      }
    }
  });

  it('never paints the roving current item as selected on its own', () => {
    // F-46 (2026-10-22): a menu opened by pointer starts with its first item
    // current, and filling that item made it read as already chosen. Keyboard
    // focus, hover, checked state and an open submenu carry the highlight.
    for (const rule of all) {
      for (const selector of rule.selectors) {
        if (!/\.varve-menu__item--current\b/.test(selector)) continue;
        const ownState = /\.varve-menu__item--current(\s|$)/.test(selector);
        const fills =
          rule.declarations.has('background') || rule.declarations.has('background-color');
        expect(ownState && fills, `${selector} paints a fill`).toBe(false);
      }
    }
  });
});
