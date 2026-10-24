import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide scrollbar guard.
 *
 * In WebKit (WebKitGTK on Linux, WKWebView on macOS) and Chromium, a standard
 * `scrollbar-width` or `scrollbar-color` on an element switches it to the
 * platform's native scrollbar and ignores `::-webkit-scrollbar`. On Linux and
 * macOS the native scrollbar is an overlay that takes no layout space, so it
 * floats over the last ~10px of content and `scrollbar-gutter: stable` reserves
 * nothing (measured in WebKitGTK: 0px with either property, 8px with only
 * `::-webkit-scrollbar`). The one skin lives in `scrollbar.css`; Firefox gets
 * the standard properties there, behind a Firefox-only `@supports` test.
 *
 * Components may hide a bar with `scrollbar-width: none`; nothing else.
 * `ScrollArea.css` is the other file that sets the properties, for Firefox only.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-pages', 'dist-try', '.worktrees', '.tmp']);
/** Files that own the standard properties, each inside the Firefox-only gate. */
const OWNERS = new Set([
  'packages/ui/src/components/scrollbar.css',
  'packages/ui/src/components/ScrollArea.css',
]);
const FIREFOX_GATE = '@supports selector(:-moz-focusring)';

function collectCss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectCss(full, out);
    else if (full.endsWith('.css')) out.push(full);
  }
  return out;
}

const files = collectCss(join(ROOT, 'packages')).map((full) => ({
  rel: full.slice(ROOT.length + 1).replaceAll('\\', '/'),
  text: readFileSync(full, 'utf8'),
}));

/** Declarations of the standard scrollbar properties, with their line numbers. */
function standardDeclarations(text: string): Array<{ line: number; decl: string }> {
  const found: Array<{ line: number; decl: string }> = [];
  text.split('\n').forEach((raw, index) => {
    const decl = raw.trim();
    if (/^scrollbar-(width|color)\s*:/.test(decl)) found.push({ line: index + 1, decl });
  });
  return found;
}

describe('scrollbar system', () => {
  it('no component sets scrollbar-width or scrollbar-color (only scrollbar-width: none)', () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      if (OWNERS.has(rel)) continue;
      for (const { line, decl } of standardDeclarations(text)) {
        if (/^scrollbar-width\s*:\s*none\b/.test(decl)) continue;
        offenders.push(`${rel}:${line}  ${decl}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the owning files set the standard properties only for Firefox or forced colors', () => {
    const offenders: string[] = [];
    for (const rel of OWNERS) {
      const file = files.find((f) => f.rel === rel);
      expect(file, `${rel} exists`).toBeDefined();
      if (!file) continue;
      const lines = file.text.split('\n');
      for (const { line, decl } of standardDeclarations(file.text)) {
        const before = lines.slice(0, line - 1).join('\n');
        const gate = before.lastIndexOf(FIREFOX_GATE);
        const forced = before.lastIndexOf('@media (forced-colors: active)');
        // The nearest enclosing at-rule must be the Firefox gate or forced colors.
        const opened = Math.max(gate, forced);
        const closedAfter = opened === -1 ? -1 : before.slice(opened).search(/\n\}\s*\n/);
        if (opened === -1 || closedAfter !== -1) offenders.push(`${rel}:${line}  ${decl}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the global WebKit/Chromium skin is an 8px ::-webkit-scrollbar', () => {
    const skin = files.find((f) => f.rel === 'packages/ui/src/components/scrollbar.css');
    expect(skin?.text).toMatch(/^::-webkit-scrollbar\s*\{[^}]*width:\s*8px/m);
  });
});
