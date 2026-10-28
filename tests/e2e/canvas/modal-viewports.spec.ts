import { expect, type Page, test } from '@playwright/test';
import { openEnhance, rect, SHORT } from './modal-viewports.helpers';

/**
 * Viewport contract for the image-workflow modals at a SHORT window.
 *
 * image-modal-aspect.spec.ts proves the stage keeps its aspect at a window tall
 * enough for the whole workbench. These specs run at 1918x729 — a real browser
 * window with the tab strip and a dev-tools bar eating the height — where each
 * of the following used to fail:
 *
 *  - Enhance: the preview column was as tall as the settings column, so the
 *    hint line and the Inspect-region control slid under the dialog footer and
 *    the preview scrolled away with the settings.
 *  - Enhance at 200%: the stage grew to the bitmap (1033px) instead of
 *    panning, which pushed every control off screen.
 *  - Enhance: every setting change flashed "No processed preview yet" and
 *    resized the stage four times before the result landed.
 *  - Vectorize: Apply trace sat at the bottom of a scrolling column, Apply left
 *    the dialog open on its "select an image layer" empty state, and Cancel
 *    never closed the dialog.
 *  - File Thumbnail: Apply / Cancel were the last row of the scrolling body.
 */
test.describe.configure({ mode: 'default' });

/**
 * A setting change that regenerates the preview without changing its geometry:
 * Fast and Quality both upscale 2x. (Scale would change the box at 100%/200%,
 * and the Quality policy is not offered for a plain upscale.)
 */
async function chooseFastMode(page: Page) {
  await page.getByRole('combobox', { name: 'Upscale quality' }).click();
  await page.getByRole('option', { name: 'Fast', exact: true }).click();
}

const zoomLabel = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Preview zoom' }).locator('label', {
    hasText: new RegExp(`^\\s*${name}\\s*$`),
  });
const viewLabel = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Preview view' }).locator('label', {
    hasText: new RegExp(`^\\s*${name}\\s*$`),
  });

test.describe('Enhance image at a short window', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(SHORT);
  });

  test('keeps the whole preview column on screen and scrolls only the settings', async ({
    page,
  }, testInfo) => {
    await openEnhance(page, testInfo);
    // At 729px the Upscale settings now fit with no scrollbar at all. A window
    // genuinely too short for them is where the one inner scroller has to work.
    await page.setViewportSize({ width: 1918, height: 600 });

    const geo = await page.evaluate(() => {
      const body = document.querySelector('dialog.upscale-dialog .varve-dialog__body');
      const settings = document.querySelector('.upscale-settings') as HTMLElement | null;
      const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      return {
        bodyBottom: body?.getBoundingClientRect().bottom ?? 0,
        bodyScroll: body ? { sh: body.scrollHeight, ch: body.clientHeight } : null,
        hintBottom: r('.upscale-preview__hint')?.bottom ?? 0,
        regionBottom: r('.upscale-preview__region-select')?.bottom ?? 0,
        stageBottom: r('.upscale-preview__viewport')?.bottom ?? 0,
        footerTop: r('.upscale-preview__footer')?.top ?? 0,
        settingsOverflowY: settings ? getComputedStyle(settings).overflowY : null,
        settingsScroll: settings ? { sh: settings.scrollHeight, ch: settings.clientHeight } : null,
      };
    });

    // Nothing in the preview column is clipped by, or hidden under, the
    // dialog footer — the hint and the region control are the lines that used
    // to be cut.
    expect(geo.hintBottom).toBeLessThanOrEqual(geo.bodyBottom + 1);
    expect(geo.regionBottom).toBeLessThanOrEqual(geo.bodyBottom + 1);
    expect(geo.stageBottom).toBeLessThanOrEqual(geo.footerTop + 1);
    // The body is never the scroller here; the settings column is, and it is
    // actually scrollable at this height (otherwise this test proves nothing).
    expect(geo.bodyScroll!.sh).toBeLessThanOrEqual(geo.bodyScroll!.ch + 1);
    expect(geo.settingsOverflowY).toBe('auto');
    expect(geo.settingsScroll!.sh).toBeGreaterThan(geo.settingsScroll!.ch);

    // The last setting is reachable by scrolling the column, and the preview
    // does not move while it does.
    const before = await rect(page, '.upscale-preview__viewport');
    await page.locator('.upscale-settings').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByRole('radiogroup', { name: 'Output behavior' })).toBeInViewport();
    const after = await rect(page, '.upscale-preview__viewport');
    expect(after).toEqual(before);
  });

  test('pans inside a fixed stage at 100% and 200% instead of growing the dialog', async ({
    page,
  }, testInfo) => {
    await openEnhance(page, testInfo);
    const fit = await rect(page, '.upscale-preview__viewport');
    const bodyBefore = await page.evaluate(() => {
      const b = document.querySelector('dialog.upscale-dialog .varve-dialog__body')!;
      return { sh: b.scrollHeight, ch: b.clientHeight };
    });

    for (const zoom of ['100%', '200%']) {
      await zoomLabel(page, zoom).click();
      await expect(page.locator('.upscale-preview__viewport')).toHaveAttribute('data-zoom', zoom);
      const stage = await rect(page, '.upscale-preview__viewport');
      // Same box at every zoom: the stage is bounded by the dialog, never by
      // the bitmap it is showing.
      expect(stage!.h).toBeCloseTo(fit!.h, 0);
      expect(stage!.w).toBeCloseTo(fit!.w, 0);
      const body = await page.evaluate(() => {
        const b = document.querySelector('dialog.upscale-dialog .varve-dialog__body')!;
        return { sh: b.scrollHeight, ch: b.clientHeight };
      });
      expect(body).toEqual(bodyBefore);
      // The hint and region control are still on screen at this zoom.
      await expect(page.getByRole('combobox', { name: 'Inspect region' })).toBeInViewport();
    }

    // At 200% the bitmap overflows the stage, which is what scrolling is for.
    const scroll = await page.locator('.upscale-preview__viewport').evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
      sh: el.scrollHeight,
      ch: el.clientHeight,
    }));
    expect(scroll.sh).toBeGreaterThan(scroll.ch);
  });

  test('centres a small surface and Center / drag move the view', async ({ page }, testInfo) => {
    await openEnhance(page, testInfo);
    await zoomLabel(page, '200%').click();
    await viewLabel(page, 'Before').click();
    const stage = page.locator('.upscale-preview__viewport');

    // Center restores the inspection origin from anywhere.
    await stage.evaluate((el) => el.scrollTo({ left: 0, top: 0 }));
    await page.getByRole('button', { name: 'Center', exact: true }).click();
    const centred = await stage.evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
      wantLeft: (el.scrollWidth - el.clientWidth) / 2,
      wantTop: (el.scrollHeight - el.clientHeight) / 2,
    }));
    expect(Math.abs(centred.left - centred.wantLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(centred.top - centred.wantTop)).toBeLessThanOrEqual(1);

    // Dragging pans (the grab cursor is a promise): the content follows the
    // pointer, so dragging up and left scrolls down and right.
    const box = (await stage.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 20, startY - 40, { steps: 4 });
    await page.mouse.up();
    const dragged = await stage.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    expect(dragged.top - centred.top).toBeGreaterThan(30);
    expect(dragged.left).toBeGreaterThan(centred.left);

    // While comparing, the same drag moves the before/after split and leaves
    // the pan alone.
    await viewLabel(page, 'Compare').click();
    await stage.evaluate((el) => el.scrollTo({ left: 0, top: 0 }));
    const splitBefore = await page.getByRole('slider').getAttribute('aria-valuenow');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 120, startY, { steps: 4 });
    await page.mouse.up();
    expect(await page.getByRole('slider').getAttribute('aria-valuenow')).not.toBe(splitBefore);
    expect(await stage.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('a setting change never flashes the pending notice or resizes the stage', async ({
    page,
  }, testInfo) => {
    await openEnhance(page, testInfo);
    await page.evaluate(() => {
      const w = window as unknown as { __seen: Set<string>; __pending: boolean; __stop: boolean };
      w.__seen = new Set();
      w.__pending = false;
      w.__stop = false;
      const tick = () => {
        const c = document.querySelector('.upscale-preview__image-container');
        if (c) {
          const b = c.getBoundingClientRect();
          w.__seen.add(`${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        if (document.querySelector('.upscale-preview__pending')) w.__pending = true;
        if (!w.__stop) requestAnimationFrame(tick);
      };
      tick();
    });
    const upscaled = page.locator('.upscale-preview__image--upscaled');
    const before = await upscaled.getAttribute('src');
    await chooseFastMode(page);
    // The CPU preview can finish inside one polling interval, so "Generating"
    // is not a state to wait for. Wait for the result to actually change, then
    // for the status to clear; the frame sampler above saw every frame between.
    await expect
      .poll(() => upscaled.getAttribute('src', { timeout: 30000 }), { timeout: 30000 })
      .not.toBe(before);
    await expect(page.getByText('Generating preview…')).toHaveCount(0, { timeout: 30000 });
    const seen = await page.evaluate(() => {
      const w = window as unknown as { __seen: Set<string>; __pending: boolean; __stop: boolean };
      w.__stop = true;
      return { sizes: [...w.__seen], pending: w.__pending };
    });
    // One stage size for the whole round trip: the result swapping in must not
    // be visible as geometry.
    expect(seen.sizes, `stage sizes seen: ${seen.sizes.join(', ')}`).toHaveLength(1);
    // Requested is not failed: no "No processed preview yet" while queued.
    expect(seen.pending).toBe(false);
  });

  test('a setting change at 200% keeps the pan where the user left it', async ({
    page,
  }, testInfo) => {
    await openEnhance(page, testInfo);
    await zoomLabel(page, '200%').click();
    const stage = page.locator('.upscale-preview__viewport');
    await stage.evaluate((el) => el.scrollTo({ left: 10, top: 120 }));
    const before = await stage.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    const upscaled = page.locator('.upscale-preview__image--upscaled');
    const src = await upscaled.getAttribute('src');
    await chooseFastMode(page);
    await expect
      .poll(() => upscaled.getAttribute('src', { timeout: 30000 }), { timeout: 30000 })
      .not.toBe(src);
    await expect(page.getByText('Generating preview…')).toHaveCount(0, { timeout: 30000 });
    const after = await stage.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    expect(after).toEqual(before);
  });

  test('the comparison slider shows its focus ring over the handle shadow', async ({
    page,
  }, testInfo) => {
    await openEnhance(page, testInfo);
    const handle = page.locator('.upscale-preview__slider-handle');
    const resting = await handle.evaluate((el) => getComputedStyle(el).boxShadow);
    // A key press makes the focus keyboard-initiated, so :focus-visible applies.
    await page.getByRole('slider', { name: 'Before / after comparison' }).focus();
    await page.keyboard.press('ArrowLeft');
    const focused = await handle.evaluate((el) => getComputedStyle(el).boxShadow);
    // The ring is a 3px spread; the resting raised shadow is a blurred offset.
    // The ring's rule is higher-specificity and declared after the base rule,
    // and must keep winning wherever it sits in the file.
    expect(focused).not.toBe(resting);
    expect(focused).toMatch(/0px 0px 0px 3px/);
  });

  test('does not offer controls that cannot change the result', async ({ page }, testInfo) => {
    await openEnhance(page, testInfo);
    // Plain upscaling: the Quality policy only picks a default strength for
    // steps that were not given one, and this dialog always gives one — so it
    // used to be a toggle that regenerated an identical preview. Denoise sat
    // disabled under Upscale. Neither is offered now, and neither takes a row
    // the settings column does not have.
    await expect(page.getByRole('radiogroup', { name: 'Quality policy' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Denoise strength' })).toHaveCount(0);
    // The controls that do change the result are all there.
    await expect(page.getByRole('combobox', { name: 'Upscale quality' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Scale factor' })).toBeVisible();
  });

  test('stacks into one scroll flow on a very short window', async ({ page }, testInfo) => {
    await openEnhance(page, testInfo);
    await page.setViewportSize({ width: 1100, height: 480 });
    const dialog = page.getByRole('dialog', { name: 'Enhance image' });
    await expect(dialog).toBeVisible();
    const geo = await page.evaluate(() => {
      const body = document.querySelector(
        'dialog.upscale-dialog .varve-dialog__body',
      ) as HTMLElement;
      const d = document.querySelector('dialog.upscale-dialog')!.getBoundingClientRect();
      const stage = document.querySelector('.upscale-preview__stage')!.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(body).overflowY,
        dialogBottom: d.bottom,
        win: innerHeight,
        stageH: stage.height,
      };
    });
    expect(geo.overflowY).toBe('auto');
    expect(geo.dialogBottom).toBeLessThanOrEqual(geo.win + 1);
    expect(geo.stageH).toBeGreaterThan(150);
    // The footer action stays reachable without scrolling anything.
    await expect(dialog.getByRole('button', { name: /Upscale image|Apply/ })).toBeInViewport();
  });
});
