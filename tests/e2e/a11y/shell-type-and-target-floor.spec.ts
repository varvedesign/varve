/**
 * Shell type floor.
 *
 * Written against the *rendered* box, not the CSS source, because the defect it
 * locks was produced by a fluid `clamp()` that looked correct in source and
 * shrank only at real window sizes.
 *
 * Finding A-02 (shell + Home audit, 2026-10-22): `--insp-label-size` was
 * `clamp(0.6875rem, 0.663rem + 0.1087vw, 0.75rem)`, i.e. 11.0-11.99px for every
 * window narrower than 1280px. `tauri.conf.json` ships the app down to 900px
 * wide, so inspector labels measured 11.5863px at 900x600 — below the 12px
 * `interface-micro` floor in docs/architecture/interface-sizing-system.md.
 *
 * Run: npx playwright test tests/e2e/a11y/shell-type-and-target-floor.spec.ts \
 *        --project=chromium --workers=1
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** The `interface-micro` type floor from interface-sizing-system.md. */
const TYPE_FLOOR = 12;

/** WCAG 2.2 AA 2.5.8 minimum pointer target. */
const TARGET_FLOOR = 24;

const VIEWPORTS = [
  { width: 900, height: 600, label: 'minimum supported window' },
  { width: 1440, height: 900, label: 'default window' },
] as const;

for (const viewport of VIEWPORTS) {
  test(`inspector labels stay at or above the type floor @${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await navigateToEditor(page);

    const labels = await page.$$eval('.insp-field__label', (elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => ({
          text: (element.textContent ?? '').trim().slice(0, 32),
          px: Number.parseFloat(getComputedStyle(element).fontSize),
        })),
    );

    // Guard the guard: an empty set would make the assertion vacuous.
    expect(labels.length, 'expected inspector labels to be rendered').toBeGreaterThan(0);

    const tooSmall = labels.filter((label) => label.px < TYPE_FLOOR);
    expect(
      tooSmall,
      `labels below the ${TYPE_FLOOR}px floor at ${viewport.width}px: ${JSON.stringify(tooSmall)}`,
    ).toEqual([]);
  });
}

/**
 * Finding A-04: the canvas micro-hint's dismiss control was a hand-rolled
 * `<button>` that drew a literal "x" character in a 13.4x13px box — under the
 * 24x24 WCAG 2.2 AA 2.5.8 target floor, and bypassing the shared CloseButton
 * states that interface-sizing-system.md requires for every dismiss control.
 */
test(`micro-hint dismiss meets the ${TARGET_FLOOR}px target floor`, async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await navigateToEditor(page);

  // Pressing a tool shortcut raises that tool's onboarding hint; the dismiss
  // control is the only interactive part of it.
  await page.keyboard.press('r');
  const dismiss = page.locator('.micro-hint__dismiss');
  await expect(dismiss).toBeVisible({ timeout: 5000 });

  const box = await dismiss.boundingBox();
  expect(box, 'dismiss control must have a box').not.toBeNull();
  expect(box?.width ?? 0, 'target width').toBeGreaterThanOrEqual(TARGET_FLOOR);
  expect(box?.height ?? 0, 'target height').toBeGreaterThanOrEqual(TARGET_FLOOR);
});
