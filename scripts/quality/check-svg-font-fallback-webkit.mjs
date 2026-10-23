/**
 * Cross-engine check for the exported-SVG font-family fix (vectorcraft#3135).
 *
 * Chromium evidence showed that an unquoted multi-word family in the SVG
 * `font-family` attribute is parsed as one unmatched name and falls through to
 * the viewer default (serif), while the quoted form reaches the generic
 * fallback. This runs the same comparison in Playwright's WebKitGTK build —
 * the engine family the Tauri app embeds — so the claim is not Chromium-only.
 *
 * Usage (needs a display):
 *   PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
 *     xvfb-run -a node scripts/quality/check-svg-font-fallback-webkit.mjs
 */
import { webkit } from '@playwright/test';

const variants = [
  { id: 'unquoted', attr: 'font-family="Source Sans 3, sans-serif"' },
  { id: 'quoted', attr: `font-family="'Source Sans 3', sans-serif"` },
  { id: 'none', attr: '' },
];

const browser = await webkit.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
const svgs = variants
  .map(
    ({ id, attr }) =>
      `<svg width="620" height="60"><text id="${id}" x="0" y="40" font-size="32" ${attr}>Handgloves 2026</text></svg>`,
  )
  .join('');
await page.setContent(
  `<!doctype html><html><body style="margin:0;background:#fff">${svgs}</body></html>`,
);
await page.waitForTimeout(250);

const result = await page.evaluate(
  (ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      out[id] = {
        family: getComputedStyle(el).fontFamily,
        width: Number(el.getBBox().width.toFixed(1)),
      };
    }
    return out;
  },
  variants.map((v) => v.id),
);

await page.screenshot({ path: 'reports/vectorcraft/svg-font-fallback-webkitgtk.png' });
await browser.close();

// The observable difference is whether the viewer *parses* the list at all.
// WebKit reports the quoted form as the list it was given, and the unquoted
// form as its standard face — it read the whole value as one family name and
// matched nothing. Widths can coincide when the configured generic and the
// default face are the same font, so metrics alone are not the signal.
const quotedParsed = /sans-serif/.test(result.quoted.family);
const unquotedParsed = /sans-serif/.test(result.unquoted.family);
const ok = quotedParsed && !unquotedParsed;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  ok
    ? 'PASS: WebKit parses the quoted list (generic fallback reachable) and treats the unquoted value as one unmatched family\n'
    : 'FAIL: WebKit did not distinguish the quoted and unquoted forms\n',
);
process.exit(ok ? 0 : 1);
