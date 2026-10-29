/**
 * E2E: a document that uses a font this host does not have must ask the user
 * to resolve it, rather than painting the fallback and reporting nothing.
 *
 * The registry seeds a list of common system families (Arial, Helvetica,
 * Meiryo, Noto Sans CJK, …) so a fresh document has something to resolve.
 * Those seeds used to be treated as proof the host had the font, so preflight,
 * the Missing Fonts dialog, and the export preflight all reported the
 * typography as faithful while the canvas drew the CSS fallback.
 *
 * `Meiryo` is a seed family that is not installed on the Linux CI image, which
 * makes it the reproduction for the defect. The probe is measured against the
 * real host here, so this spec is only meaningful where Meiryo is absent; it
 * skips on a host that has it instead of asserting a fiction.
 */

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const ABSENT_SEED_FAMILY = 'Meiryo';

async function hostHasFamily(page: import('@playwright/test').Page, family: string) {
  return page.evaluate((candidate) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return true; // Cannot tell: do not assert.
    const probe = 'mmmmmmmmmmlliWMQ@#';
    const sentinel = '"__varve_e2e_absent_family__"';
    const width = (font: string) => {
      ctx.font = font;
      return ctx.measureText(probe).width;
    };
    return ['monospace', 'serif', 'sans-serif'].some((generic) => {
      const withFamily = width(`72px "${candidate}", ${generic}`);
      const withoutFamily = width(`72px ${sentinel}, ${generic}`);
      if (!(withFamily > 0) || !(withoutFamily > 0)) return true;
      return Math.abs(withFamily - withoutFamily) > 0.01;
    });
  }, family);
}

/** Figma JSON with one text node in `fontFamily`. */
function textFixture(fontFamily: string) {
  return {
    name: 'Missing seed family',
    document: {
      type: 'DOCUMENT',
      children: [
        {
          id: 'page:1',
          type: 'CANVAS',
          name: 'Typography',
          children: [
            {
              id: 'text:1',
              type: 'TEXT',
              name: 'Seed family text',
              characters: 'Typeset in a family this host does not have',
              absoluteBoundingBox: { x: 64, y: 64, width: 520, height: 48 },
              style: { fontFamily, fontSize: 28, fontWeight: 400 },
            },
          ],
        },
      ],
    },
  };
}

test.describe('Host font availability', () => {
  test('a seed family the host lacks is reported as a missing font', async ({ page }, testInfo) => {
    await navigateToEditor(page);

    test.skip(
      await hostHasFamily(page, ABSENT_SEED_FAMILY),
      `${ABSENT_SEED_FAMILY} is installed on this host; the reproduction requires it to be absent`,
    );

    await page.locator('#file-import-input').setInputFiles({
      name: 'missing-seed-family.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(textFixture(ABSENT_SEED_FAMILY)), 'utf8'),
    });

    const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
    if (await report.isVisible({ timeout: 1000 }).catch(() => false)) {
      await report.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(report).toHaveCount(0);
    }

    // The user is told the typography is not faithful, and which family.
    const dialog = page.getByRole('dialog', { name: 'Missing Fonts' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText(ABSENT_SEED_FAMILY);

    await page.screenshot({
      path: testInfo.outputPath('missing-seed-family-dialog.png'),
      fullPage: false,
    });
  });

  test('a bundled family does not raise the missing-font dialog', async ({ page }) => {
    // Bundled faces ship with the app, so the probe must never judge them.
    await navigateToEditor(page);

    await page.locator('#file-import-input').setInputFiles({
      name: 'bundled-family.fig',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(textFixture('IBM Plex Sans Variable')), 'utf8'),
    });

    const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
    if (await report.isVisible({ timeout: 1000 }).catch(() => false)) {
      await report.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(report).toHaveCount(0);
    }

    await expect(page.getByRole('dialog', { name: 'Missing Fonts' })).toHaveCount(0);
  });
});
