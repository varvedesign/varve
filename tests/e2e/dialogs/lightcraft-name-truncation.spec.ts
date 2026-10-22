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
/** 44 CJK characters then family emoji: the 48-grapheme cut lands inside one. */
const DOCUMENT_NAME = `${'\u4e2d'.repeat(44)}${FAMILY.repeat(6)}`;

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

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
    const dialog = page.locator('dialog[open]').last();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 15000 });

    const text = (await dialog.textContent()) ?? '';
    expect(loneSurrogates(text)).toEqual([]);
    // Every visible family emoji keeps both joiners: no partial ZWJ sequence.
    const man = '\u{1F468}';
    let index = text.indexOf(man);
    expect(index).toBeGreaterThanOrEqual(0);
    while (index >= 0) {
      expect(text.slice(index, index + 3)).toBe(`\u{1F468}\u200D\u{1F469}`);
      index = text.indexOf(man, index + 1);
    }
    // The 48-grapheme budget is honoured: 44 CJK + 3 families + ellipsis.
    expect(text).toContain(`${'\u4e2d'.repeat(44)}${FAMILY}${FAMILY}${FAMILY}\u2026`);

    await page.screenshot({ path: `${REVIEW_DIR}/close-dialog-grapheme-name.png`, fullPage: true });
    // Leave no unsaved work behind for later specs in the same context.
    await dialog.getByRole('button', { name: "Don't Save" }).click();
  });
});
