/**
 * Throwaway diagnostic — NOT a regression test. Measures the rendered geometry
 * of the canonical SegmentedControl (track vs segment radii, gaps, truncation)
 * to confirm the reported square-selected-segment defect.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DIR = resolve(__dirname, '../../../reports/radio-group-review');
mkdirSync(DIR, { recursive: true });

async function measure(page: import('@playwright/test').Page, label: string) {
  const data = await page.evaluate(() => {
    const groups = [
      ...document.querySelectorAll<HTMLElement>('.varve-segmented'),
    ].filter((el) => el.getBoundingClientRect().height > 0);
    return groups.map((group) => {
      const cs = getComputedStyle(group);
      const r = group.getBoundingClientRect();
      const buttons = [...group.querySelectorAll<HTMLElement>('.varve-segmented__btn')].map(
        (btn) => {
          const bcs = getComputedStyle(btn);
          const br = btn.getBoundingClientRect();
          const input = btn.querySelector<HTMLInputElement>('input');
          const labelEl = btn.querySelector<HTMLElement>('.varve-segmented__label');
          return {
            text: (btn.textContent ?? '').trim(),
            checked: input?.checked ?? false,
            radius: bcs.borderRadius,
            bg: bcs.backgroundColor,
            w: +br.width.toFixed(1),
            h: +br.height.toFixed(1),
            labelScrollW: labelEl?.scrollWidth ?? null,
            labelClientW: labelEl?.clientWidth ?? null,
            truncated: labelEl ? labelEl.scrollWidth > labelEl.clientWidth + 1 : null,
            hiddenLabel: labelEl
              ? getComputedStyle(labelEl).display === 'none' ||
                labelEl.classList.contains('varve-visually-hidden')
              : null,
          };
        },
      );
      return {
        name: group.getAttribute('aria-label'),
        className: group.className,
        variant: group.className.includes('--pill') ? 'pill' : 'default',
        display: cs.display,
        gridTemplateColumns: cs.gridTemplateColumns,
        gap: cs.gap,
        padding: cs.padding,
        trackRadius: cs.borderRadius,
        trackW: +r.width.toFixed(1),
        trackH: +r.height.toFixed(1),
        overflow: cs.overflow,
        buttons,
      };
    });
  });
  console.log(`\n=== SEGMENTED ${label} ===\n${JSON.stringify(data, null, 2)}`);
  return data;
}

test('diagnose segmented control geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });

  const isoHeader = page.getByRole('button', { name: /isometric grid/i });
  await isoHeader.scrollIntoViewIfNeeded();
  await isoHeader.click();
  await page.waitForTimeout(200);

  const planeGroup = page.getByRole('radiogroup', { name: /active construction plane/i });
  await planeGroup.scrollIntoViewIfNeeded();
  await planeGroup.screenshot({ path: resolve(DIR, 'construction-plane.png') });

  for (const rail of [513, 360, 300, 240]) {
    await page.locator('.editor-shell').evaluate((shell, next) => {
      (shell as HTMLElement).style.setProperty('--inspector-width', `${next}px`);
    }, rail);
    await page.waitForTimeout(150);
    await planeGroup.screenshot({ path: resolve(DIR, `construction-plane-rail${rail}.png`) });
    await measure(page, `rail ${rail}`);
  }

  // Narrow viewport at a fixed rail: does the grid wrap?
  await page.locator('.editor-shell').evaluate((shell) => {
    (shell as HTMLElement).style.setProperty('--inspector-width', '320px');
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(200);
  await planeGroup.screenshot({ path: resolve(DIR, 'construction-plane-viewport900.png') });
  await measure(page, 'viewport 900 rail 320');

  // Pill variant on the home/start surface.
  await page.goto('/');
  await page.waitForTimeout(600);
  const pill = page.locator('.varve-segmented--pill').first();
  if (await pill.count()) {
    await pill.screenshot({ path: resolve(DIR, 'home-pill.png') });
    await measure(page, 'home pill');
    await page.setViewportSize({ width: 480, height: 800 });
    await page.waitForTimeout(200);
    await pill.screenshot({ path: resolve(DIR, 'home-pill-narrow.png') });
    await measure(page, 'home pill narrow');
  } else {
    console.log('no pill variant found on home');
  }
  expect(true).toBe(true);
});
