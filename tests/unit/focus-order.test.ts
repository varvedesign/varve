import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Keyboard focus order must follow the reading order, by construction.
 *
 * OpenPencil #180 reports "tab order in inspector panel behaves unexpectedly".
 * In Varve the Inspector has never used a positive `tabIndex` or a CSS `order`
 * reorder, so DOM order and visual order are the same thing and the browser's
 * natural tab order is correct. Those two properties are the only ways to break
 * that without anyone noticing, and they are cheap to scan for — so this guard
 * keeps them true instead of relying on a periodic keyboard walk.
 *
 * `tabIndex={-1}` is fine and deliberately not flagged: it removes an element
 * from the tab sequence (roving tabindex, programmatic focus targets), which
 * cannot reorder anything.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = [join(ROOT, 'packages', 'editor', 'src'), join(ROOT, 'packages', 'ui', 'src')];
const SOURCE = /\.(tsx?|jsx?)$/;
const STYLE = /\.css$/;

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const info = statSync(full, { throwIfNoEntry: false });
    if (!info) continue;
    if (info.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const files = SCAN_DIRS.flatMap((dir) => walk(dir));

/** `tabIndex={2}` / `tabIndex="3"` / `tabindex='4'` — any value above zero. */
const POSITIVE_TABINDEX = /\btabIndex\s*=\s*\{?\s*["']?([1-9][0-9]*)\b/;

/**
 * A CSS `order` declaration inside a flex/grid container moves the box without
 * moving its position in the tab sequence. Test files and comments are excluded
 * by only scanning stylesheets.
 */
const CSS_ORDER = /(?:^|[{;\s])order\s*:\s*-?\d+/;

/**
 * Deliberate exceptions, each with the reason the tab sequence is unaffected.
 * Keep this list short and justified — an entry here is a claim that the
 * reordered box is not focusable.
 */
const CSS_ORDER_ALLOWED = new Map([
  [
    'packages/editor/src/components/Presentation/presentationDelivery.css',
    'In the mobile audience-control bar, `order: -1` promotes a status <span> ' +
      '(not focusable) above the buttons on narrow screens; the buttons keep ' +
      'their DOM order and therefore their tab order.',
  ],
]);

describe('focus order', () => {
  it('uses no positive tabIndex anywhere in the editor or UI packages', () => {
    const offenders = [];
    for (const file of files.filter((f) => SOURCE.test(f))) {
      const source = readFileSync(file, 'utf8');
      const match = POSITIVE_TABINDEX.exec(source);
      if (match) offenders.push(`${file.replace(`${ROOT}/`, '')}: tabIndex={${match[1]}}`);
    }
    expect(
      offenders,
      'A positive tabIndex overrides DOM order and desynchronises keyboard focus from the visual order. Use DOM order for sequence and tabIndex={-1} to remove an element from the tab sequence.',
    ).toEqual([]);
  });

  it('does not reorder flex or grid children with CSS order', () => {
    const offenders = [];
    for (const file of files.filter((f) => STYLE.test(f))) {
      const source = readFileSync(file, 'utf8');
      const relative = file.replace(`${ROOT}/`, '');
      if (CSS_ORDER_ALLOWED.has(relative)) continue;
      if (CSS_ORDER.test(source)) offenders.push(relative);
    }
    expect(
      offenders,
      'CSS order moves a box visually without moving its position in the tab sequence. Order the DOM instead, or the Inspector will tab through controls in an order that does not match what the user sees.',
    ).toEqual([]);
  });
});
