/**
 * Evidence: storytold/lightcraft#266 — a file-name truncation cut into a
 * multi-byte character and panicked in the filmstrip. Varve's close/quit
 * dialog truncated document names by UTF-16 code unit, which splits surrogate
 * pairs and ZWJ sequences in the one surface where the user must identify
 * exactly which document they are closing.
 *
 * This spec drives the real workflow: name a new document so the truncation
 * boundary lands inside a family emoji, request Close, and inspect the dialog
 * text and a screenshot. A unit test cannot prove the dialog receives the
 * corrected string through the coordinator's prompt path.
 */
import { expect, test } from '@playwright/test';
import { dismissFirstRunOverlayIfPresent } from '../helpers/nav';

const REVIEW_DIR = 'reports/lightcraft-corpus';
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
/**
 * 24 CJK characters then 25 family emoji: 49 graphemes, so the 48-grapheme cut
 * lands inside the emoji run. The CJK prefix is short enough that the first
 * emoji survives wrapping in the screenshot, which is the point of the visual
 * check — a cut that only appears off-screen proves nothing.
 */
const DOCUMENT_NAME = `${'\u4e2d'.repeat(24)}${FAMILY.repeat(25)}`;

function loneSurrogates(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) found.push(text.slice(i, i + 1));
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      const prev = text.charCodeAt(i - 1);
      if (!(prev >= 0xd800 && prev <= 0xdbff)) found.push(text.slice(i, i + 1));
    }
  }
  return found;
}

test.describe('document-name truncation in the close dialog', () => {
  test('never splits a grapheme cluster', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 150000 });
    await page.getByRole('button', { name: /^new$/i }).click({ force: true });

    const nameInput = page.getByLabel('Document name');
    await nameInput.waitFor({ timeout: 30000 });
    await nameInput.fill('');
    await nameInput.pressSequentially(DOCUMENT_NAME, { delay: 0 });
    await expect(nameInput).toHaveValue(DOCUMENT_NAME);

    await page.getByRole('button', { name: /^create design$/i }).click({ timeout: 30000 });
    await page.locator('.layers-panel').waitFor({ timeout: 150000 });
    await dismissFirstRunOverlayIfPresent(page);

    // Make the document genuinely dirty; an untouched new document closes
    // without a prompt, which would bypass the dialog under test.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'attached', timeout: 30000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not laid out');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 220, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('v');

    // Use the menubar command rather than Ctrl+W: the browser reserves that
    // accelerator, so a headless run cannot prove the app's own binding.
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /close document/i }).click();
    const dialog = page.locator('dialog[open]').last();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible({
      timeout: 15000,
    });

    const text = (await dialog.textContent()) ?? '';
    expect(loneSurrogates(text)).toEqual([]);
    // Every visible family emoji keeps both joiners: no partial ZWJ sequence.
    const man = '\u{1F468}';
    let index = text.indexOf(man);
    expect(index).toBeGreaterThanOrEqual(0);
    while (index >= 0) {
      // man (2 code units) + ZWJ (1) + woman (2): five units, one cluster.
      expect(text.slice(index, index + 5)).toBe(`\u{1F468}\u200D\u{1F469}`);
      index = text.indexOf(man, index + 1);
    }
    // The 48-grapheme budget is honoured: 24 CJK + 23 families + ellipsis.
    expect(text).toContain(`${'\u4e2d'.repeat(24)}${FAMILY.repeat(23)}\u2026`);

    await page.screenshot({ path: `${REVIEW_DIR}/close-dialog-grapheme-name.png`, fullPage: true });
    // Leave no unsaved work behind for later specs in the same context.
    await dialog.getByRole('button', { name: "Don't Save" }).click();
  });
});
