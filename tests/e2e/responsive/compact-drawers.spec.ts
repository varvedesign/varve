/**
 * Compact drawer close routes and interface-text floor.
 *
 * The trap this pins: at <=899px every drawer is modal, so the launcher FABs —
 * which sit at `--z-raised` (10) beneath the scrim at `--z-overlay - 1` (999) —
 * are not clickable while a drawer is open. Resources was the one drawer whose
 * panel shipped no close control of its own, which left a pointer-only user with
 * the scrim strip beside the panel: 90px at 390px wide, 20px at 320px. These
 * tests assert a reachable, hit-testable close control per viewport, both
 * non-pointer-free dismiss routes, and that interface text never falls below the
 * compact floor.
 *
 * `elementFromPoint` assertions are deliberate: `toBeVisible()` alone permits a
 * control that is painted but covered, which is exactly the failure being
 * guarded.
 */

import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORTS = [
  { label: '320x640 (reflow floor)', width: 320, height: 640 },
  { label: '390x844 portrait sheet', width: 390, height: 844 },
  { label: '640x400 landscape', width: 640, height: 400 },
  { label: '899x600 (last compact tier)', width: 899, height: 600 },
] as const;

const closeControl = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Close Resources panel' });

/** Wait until the element's box stops moving, so hit tests read settled layout. */
async function waitForStableBox(locator: import('@playwright/test').Locator): Promise<void> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const current = box ? `${box.x},${box.y},${box.width},${box.height}` : null;
        const stable = current !== null && current === previous;
        previous = current;
        return stable;
      },
      { message: 'panel layout must settle before hit testing' },
    )
    .toBe(true);
}

/**
 * What a real pointer would activate at the centre of `locator`.
 *
 * Returns the hit element's own description plus whether `locator` (or one of
 * its descendants) owns it: a control's icon is a legitimate nested target, so
 * containment — not identity — is the contract.
 */
async function hitAtCentre(
  locator: import('@playwright/test').Locator,
): Promise<{ hit: string; owned: boolean }> {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      hit: hit
        ? `${hit.tagName.toLowerCase()}.${(hit.className?.toString() ?? '').split(' ')[0]}`
        : 'none',
      owned: hit !== null && element.contains(hit),
    };
  });
}

/** A point on the scrim, chosen by the drawer's own geometry. */
async function scrimPoint(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number; kind: 'sheet' | 'drawer' }> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.editor__library-panel');
    const box = panel?.getBoundingClientRect();
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    // A bottom sheet spans the full width, so its scrim is the area above it;
    // a side drawer leaves a strip beside it.
    const isSheet = box ? box.x <= 1 && box.width >= viewport.w - 1 : false;
    return isSheet
      ? {
          x: Math.round(viewport.w / 2),
          y: Math.max(4, Math.round((box?.top ?? viewport.h / 2) - 40)),
          kind: 'sheet' as const,
        }
      : {
          x: Math.max(4, Math.round((box?.left ?? 0) - 40)),
          y: Math.round(viewport.h / 2),
          kind: 'drawer' as const,
        };
  });
}

for (const viewport of VIEWPORTS) {
  test(`Resources drawer opens and closes through every route at ${viewport.label}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await navigateToEditor(page);

    const launcher = page.getByRole('button', { name: /resources panel/i });
    await expect(launcher).toBeVisible();

    // 1. Open, and confirm the drawer is presented rather than merely mounted.
    await launcher.click();
    await expect(closeControl(page)).toBeVisible();
    await waitForStableBox(closeControl(page));

    // 2. The close control must own its own hit test — painted is not reachable.
    const closeName = await closeControl(page).getAttribute('aria-label');
    expect(closeName).toBe('Close Resources panel');
    await expect
      .poll(async () => (await hitAtCentre(closeControl(page))).owned, {
        message: 'the close control (or its icon) must be what a pointer activates',
      })
      .toBe(true);

    // 3. Activating it dismisses the drawer, and the launcher comes back.
    await closeControl(page).click();
    await expect(closeControl(page)).toBeHidden();
    await expect(launcher).toBeVisible();

    // 4. Escape dismisses.
    await launcher.click();
    await expect(closeControl(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(closeControl(page)).toBeHidden();
    await expect(launcher).toBeVisible();

    // 5. The scrim dismisses — and the assertion names the element it clicks,
    //    so a mis-aimed tap fails loudly instead of testing nothing.
    await launcher.click();
    await expect(closeControl(page)).toBeVisible();
    await waitForStableBox(closeControl(page));
    const point = await scrimPoint(page);
    const hitUnderPoint = await page.evaluate((p) => {
      const hit = document.elementFromPoint(p.x, p.y);
      return hit
        ? `${hit.tagName.toLowerCase()}.${(hit.className?.toString() ?? '').split(' ')[0]}`
        : 'none';
    }, point);
    expect(
      hitUnderPoint,
      `the ${point.kind} dismiss region at (${point.x}, ${point.y}) must be the panel backdrop, not panel or canvas chrome`,
    ).toContain('editor__panel-backdrop');
    await page.mouse.click(point.x, point.y);
    await expect(closeControl(page)).toBeHidden();
    await expect(launcher).toBeVisible();
  });
}

test('interface text stays at or above the compact floor', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await navigateToEditor(page);

  const sizes = await page.evaluate(() => {
    const fontSize = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : null;
    };
    return {
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      statusBar: fontSize('.editor-status'),
      menuItem: fontSize('.editor-menubar__item'),
    };
  });
  expect(sizes.root).toBe(16);
  // The compact tier used to *reduce* these to 12px, the smallest strings in the
  // chrome, exactly where legibility is hardest.
  for (const [name, size] of [
    ['status bar', sizes.statusBar],
    ['application menu', sizes.menuItem],
  ] as const) {
    expect(size, `${name} must not fall below the compact floor`).not.toBeNull();
    expect(size!).toBeGreaterThanOrEqual(13);
  }

  // Nothing in the Resources panel may be cut off without an ellipsis.
  await page.getByRole('button', { name: /resources panel/i }).click();
  await expect(closeControl(page)).toBeVisible();
  const clipped = await page.evaluate(() => {
    const panel = document.querySelector('.editor__library-panel');
    if (!panel) return ['panel missing'];
    const offenders: string[] = [];
    for (const element of panel.querySelectorAll<HTMLElement>('button, span, label, a, li')) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const overflow = element.scrollWidth - element.clientWidth;
      if (overflow > 1 && style.textOverflow !== 'ellipsis' && style.overflowX === 'visible') {
        offenders.push(
          `${element.className} :: ${(element.textContent ?? '').trim().slice(0, 40)}`,
        );
      }
    }
    return offenders;
  });
  expect(clipped, 'text must wrap, scroll or ellipsize — never clip silently').toEqual([]);
});
