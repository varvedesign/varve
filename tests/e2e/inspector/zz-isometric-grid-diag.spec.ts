/** Throwaway diagnostic — not committed. Investigates a reported broken
 * input in the Isometric Grid (empty-selection Document panel) section. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../reports/inspector-alignment-audit');
mkdirSync(DIR, { recursive: true });

test('diagnose isometric grid spacing input', async ({ page }) => {
  await navigateToEditor(page);
  // Empty selection: the Document panel (Canvas/Snapping/.../Isometric Grid).
  const isoHeader = page.getByRole('button', { name: /isometric grid/i });
  await isoHeader.scrollIntoViewIfNeeded();
  await isoHeader.click();
  await page.waitForTimeout(200);

  const panel = page.locator('.insp-panel[role="tabpanel"]').first();
  await panel.screenshot({ path: resolve(DIR, 'iso-grid-full.png') });
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(150);
  await panel.screenshot({ path: resolve(DIR, 'iso-grid-scrolled-200.png') });
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  await panel.screenshot({ path: resolve(DIR, 'iso-grid-scrolled-500.png') });

  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(150);
  await panel.screenshot({ path: resolve(DIR, 'iso-grid-scrolled-900.png') });

  const spacingInput = page.locator('input[aria-label*="Spacing (axis step)" i]');
  await spacingInput.scrollIntoViewIfNeeded();
  await spacingInput.screenshot({ path: resolve(DIR, 'iso-grid-spacing-input.png') });

  const info = await spacingInput.evaluate((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.fontFamily = cs.fontFamily;
    probe.style.fontSize = cs.fontSize;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    document.body.appendChild(probe);
    const zeroWidth = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    return {
      zeroWidth,
      fontSizeResolved: cs.fontSize,
      fontFamilyResolved: cs.fontFamily,
      outerHTML: el.outerHTML,
      parentOuterHTML: el.parentElement?.outerHTML.slice(0, 500),
      rect: { w: rect.width, h: rect.height },
      display: cs.display,
      width: cs.width,
      flexGrow: cs.flexGrow,
      flexBasis: cs.flexBasis,
      border: cs.border,
      background: cs.backgroundColor,
      appearance: cs.appearance,
      color: cs.color,
      font: cs.font,
      boxSizing: cs.boxSizing,
      padding: cs.padding,
    };
  });
  console.log('SPACING_INPUT_INFO', JSON.stringify(info, null, 2));
});
