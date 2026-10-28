import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';
import {
  closeStartupModals,
  importGenerated,
  openEnhance,
  rect,
  SHORT,
} from './modal-viewports.helpers';

/**
 * Continuation of the short-window viewport contract in modal-viewports.spec.ts:
 * Vectorize, File Thumbnail, and the segmented-switcher / nested-scroll rules.
 */
test.describe.configure({ mode: 'default' });

test.describe('Vectorize image at a short window', () => {
  async function openVectorize(page: Page, testInfo: import('@playwright/test').TestInfo) {
    await page.setViewportSize(SHORT);
    await importGenerated(page, testInfo, 600, 400, 'shapes');
    await closeStartupModals(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 30000 });
  }

  test('keeps Apply and Cancel in the sticky footer and the preview whole', async ({
    page,
  }, testInfo) => {
    await openVectorize(page, testInfo);
    const dialog = page.locator('dialog.vectorize-dialog');
    const geo = await page.evaluate(() => {
      const d = document.querySelector('dialog.vectorize-dialog')!;
      const body = d.querySelector('.varve-dialog__body') as HTMLElement;
      const footer = d.querySelector('.varve-dialog__footer') as HTMLElement;
      const settings = d.querySelector('.vectorize__settings') as HTMLElement;
      const diag = d.querySelector('.vectorize__diagnostics')!.getBoundingClientRect();
      const stage = d.querySelector('.vectorize__preview')!.getBoundingClientRect();
      const apply = Array.from(d.querySelectorAll('button')).find((b) =>
        /^Apply trace/.test(b.textContent ?? ''),
      )!;
      return {
        dialog: { top: d.getBoundingClientRect().top, bottom: d.getBoundingClientRect().bottom },
        bodyBottom: body.getBoundingClientRect().bottom,
        bodyScroll: { sh: body.scrollHeight, ch: body.clientHeight },
        applyInFooter: footer.contains(apply),
        diagBottom: diag.bottom,
        stageBottom: stage.bottom,
        stageH: stage.height,
        settingsOverflowY: getComputedStyle(settings).overflowY,
        settingsScroll: { sh: settings.scrollHeight, ch: settings.clientHeight },
      };
    });
    expect(geo.applyInFooter).toBe(true);
    expect(geo.dialog.top).toBeGreaterThanOrEqual(-1);
    expect(geo.dialog.bottom).toBeLessThanOrEqual(SHORT.height + 1);
    expect(geo.bodyScroll.sh).toBeLessThanOrEqual(geo.bodyScroll.ch + 1);
    expect(geo.diagBottom).toBeLessThanOrEqual(geo.bodyBottom + 1);
    expect(geo.stageH).toBeGreaterThan(200);
    // Compact sliders: the settings fit this window, so the column has nothing
    // to scroll (it is still `overflow: auto` as the safety net for shorter ones).
    expect(geo.settingsOverflowY).toBe('auto');
    expect(geo.settingsScroll.sh).toBeLessThanOrEqual(geo.settingsScroll.ch + 1);
    await expect(dialog.getByRole('button', { name: /^Apply trace/ })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  });

  test('pans inside a fixed stage and centres a small trace', async ({ page }, testInfo) => {
    await openVectorize(page, testInfo);
    const stage = page.locator('.vectorize__preview');
    const fit = await rect(page, '.vectorize__preview');
    await page
      .getByRole('radiogroup', { name: 'Preview zoom' })
      .locator('label', { hasText: /^\s*200%\s*$/ })
      .click();
    await expect(stage).toHaveAttribute('data-zoom', '2');
    const zoomed = await rect(page, '.vectorize__preview');
    expect(zoomed!.h).toBeCloseTo(fit!.h, 0);

    await stage.evaluate((el) => el.scrollTo({ left: 0, top: 0 }));
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 30, { steps: 4 });
    await page.mouse.up();
    const panned = await stage.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    expect(panned.left).toBeGreaterThan(20);
    expect(panned.top).toBeGreaterThan(20);
  });

  test('Apply inserts the trace and closes the dialog', async ({ page }, testInfo) => {
    await openVectorize(page, testInfo);
    const layersBefore = await page.getByRole('treeitem').count();
    const dialog = page.locator('dialog.vectorize-dialog');
    await dialog.getByRole('button', { name: /^Apply trace/ }).click();
    // Used to stay open on "Select an image layer to vectorize it".
    await expect(dialog).toBeHidden({ timeout: 30000 });
    expect(await page.getByRole('treeitem').count()).toBeGreaterThan(layersBefore);
  });

  test('Cancel closes the dialog and leaves the document alone', async ({ page }, testInfo) => {
    await openVectorize(page, testInfo);
    const layersBefore = await page.getByRole('treeitem').count();
    const dialog = page.locator('dialog.vectorize-dialog');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await page.getByRole('treeitem').count()).toBe(layersBefore);
  });
});

test.describe('File Thumbnail at a short window', () => {
  test('keeps Apply and Cancel in the sticky footer', async ({ page }, testInfo) => {
    await page.setViewportSize(SHORT);
    await importGenerated(page, testInfo, 600, 400, 'shapes');
    await closeStartupModals(page);
    await openMenu(page, 'File');
    await page
      .getByRole('menuitem', { name: /Set File Thumbnail/i })
      .first()
      .click();
    const dialog = page.locator('dialog.thumbnail-picker');
    await expect(dialog).toBeVisible();
    const inFooter = await dialog.evaluate((d) => {
      const footer = d.querySelector('.varve-dialog__footer');
      const apply = Array.from(d.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Apply',
      );
      return Boolean(footer && apply && footer.contains(apply));
    });
    expect(inFooter).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  });
});

/** Segmented tracks wider than their segments: the stretched, uneven switchers. */
const stretchedSwitchers = (page: Page) =>
  page.evaluate(() => {
    const visible = (el: Element) => {
      const b = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    return Array.from(document.querySelectorAll('.varve-segmented'))
      .filter(visible)
      .map((track) => {
        const tr = track.getBoundingClientRect();
        const cs = getComputedStyle(track);
        const kids = Array.from(track.children).filter(visible);
        const maxRight = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        return {
          name: track.getAttribute('aria-label') ?? '',
          free: Math.round(
            tr.right - maxRight - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
          ),
        };
      })
      .filter((t) => t.free > 6);
  });

/** Scroll containers inside the open dialog that actually have something to scroll. */
const overflowingScrollers = (page: Page) =>
  page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return [];
    return Array.from(dlg.querySelectorAll('*'))
      .filter((el) => {
        const st = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return /(auto|scroll)/.test(st.overflowY) && b.height > 40 && b.width > 0;
      })
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${el.scrollHeight}/${el.clientHeight}`,
      );
  });

test.describe('Switchers and nested scrolling', () => {
  test('switchers hug their segments and Vectorize needs no inner scroll at 1120x776', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1120, height: 776 });
    await importGenerated(page, testInfo, 600, 400, 'shapes');
    await closeStartupModals(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 30000 });
    // Trace type, Trace mode and Ink color used to stretch across the whole
    // dialog (1090px of track under four segments hugging its left edge): a
    // flex-column or grid parent stretched an `auto`-width inline-flex track.
    expect(await stretchedSwitchers(page)).toEqual([]);
    for (const name of ['Trace type', 'Trace mode', 'Ink color']) {
      const box = await page.getByRole('radiogroup', { name }).boundingBox();
      expect(box!.width, `${name} track width`).toBeLessThan(500);
    }
    // And no scrollbar anywhere inside this window: sliders are compact rows.
    expect(await overflowingScrollers(page)).toEqual([]);
  });

  test('Enhance switchers hug their segments with no inner scroll at 1918x729', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(SHORT);
    await openEnhance(page, testInfo);
    expect(await stretchedSwitchers(page)).toEqual([]);
    expect(await overflowingScrollers(page)).toEqual([]);
  });

  test('Settings: the nav never scrolls and short sections do not scroll for padding', async ({
    page,
  }) => {
    await page.setViewportSize(SHORT);
    await navigateToEditor(page);
    // Focus the canvas so the shortcut is routed to the editor, as
    // dialog-system.spec does before opening Settings.
    await page.locator('canvas.editor-canvas__content-layer').click({ position: { x: 40, y: 40 } });
    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.varve-dialog--settings');
    await expect(settings).toHaveAttribute('open', '');
    // The dialog's documented contract is that only the content scrolls; 17
    // sections at the default row height made the nav a second scroller.
    const nav = await settings.locator('.settings-dialog__nav').evaluate((el) => ({
      sh: el.scrollHeight,
      ch: el.clientHeight,
    }));
    expect(nav.sh).toBeLessThanOrEqual(nav.ch + 1);
    for (const section of ['Appearance', 'Export']) {
      await settings.getByRole('tab', { name: section, exact: true }).click();
      const content = await settings.locator('.settings-dialog__content').evaluate((el) => ({
        sh: el.scrollHeight,
        ch: el.clientHeight,
      }));
      // These overflowed by 16-20px: a scrollbar that revealed only padding.
      expect(content.sh, `${section} content`).toBeLessThanOrEqual(content.ch + 1);
    }
  });
});
