import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('tablet toolbar geometry', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 520 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'varve-editor-settings',
          JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
        );
      } catch {
        // The editor defaults still apply when storage is blocked.
      }
    });
  });

  for (const viewport of [
    { width: 820, height: 520 },
    { width: 899, height: 640 },
    { width: 900, height: 700 },
    { width: 1024, height: 768 },
  ]) {
    test(`keeps toolbar controls reachable at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await navigateToEditor(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

      const toolbar = page.locator('.floating-toolbar');
      await expect(toolbar).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tablet editing controls' })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const rect = (element: Element) => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        };
        const toolbar = document.querySelector<HTMLElement>('.floating-toolbar');
        if (!toolbar) throw new Error('missing floating toolbar');
        const toolbarRect = rect(toolbar);
        const controls = [...toolbar.querySelectorAll<HTMLElement>('button:not(:disabled)')]
          .filter((button) => getComputedStyle(button).visibility !== 'hidden')
          .map((button) => ({
            label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? 'unnamed',
            ...rect(button),
          }));
        const launchers = [...document.querySelectorAll<HTMLElement>('.editor__fab')]
          .filter((element) => getComputedStyle(element).display !== 'none')
          .map(rect);
        const dock = document.querySelector<HTMLElement>('.workspace-dock__bar');
        const activeWorkspace = document.querySelector<HTMLElement>(
          '.workspace-dock__item--active',
        );
        const workspaceButtons = [
          ...document.querySelectorAll<HTMLElement>(
            '.workspace-dock__item:not(.workspace-dock__item--active), .workspace-dock__more',
          ),
        ].filter((element) => getComputedStyle(element).display !== 'none');
        const moveHandles = [
          ...document.querySelectorAll<HTMLButtonElement>('.workspace-dock-move-handle'),
        ]
          .filter((element) => getComputedStyle(element).visibility !== 'hidden')
          .map((element) => ({
            ...rect(element),
            paintedWidth: Number.parseFloat(getComputedStyle(element, '::before').width),
          }));
        const panelActions = [
          ...document.querySelectorAll<HTMLButtonElement>(
            '.editor__collapse-btn, .panel-detach-btn',
          ),
        ]
          .filter((element) => getComputedStyle(element).visibility !== 'hidden')
          .filter((element) => element.getBoundingClientRect().width > 0)
          .map((element) => ({
            ...rect(element),
            paintedWidth: Number.parseFloat(getComputedStyle(element, '::before').width),
          }));
        const layersHeaderButtons = [
          ...document.querySelectorAll<HTMLButtonElement>('.layers-panel__header-btn'),
        ]
          .filter((element) => getComputedStyle(element).visibility !== 'hidden')
          .map((element) => ({
            ...rect(element),
            paintedWidth: Number.parseFloat(getComputedStyle(element, '::before').width),
          }));
        return {
          viewport: { width: innerWidth, height: innerHeight },
          toolbar: toolbarRect,
          toolbarScrollWidth: toolbar.scrollWidth,
          toolbarClientWidth: toolbar.clientWidth,
          controls,
          launchers,
          dock: dock ? rect(dock) : null,
          activeWorkspace: activeWorkspace ? rect(activeWorkspace) : null,
          workspaceButtons: workspaceButtons.map(rect),
          moveHandles,
          panelActions,
          layersHeaderButtons,
        };
      });
      console.log(`TABLET-TOOLBAR ${JSON.stringify(geometry, null, 1)}`);

      expect(geometry.toolbar.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.toolbar.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry.toolbar.top).toBeGreaterThanOrEqual(-1);
      expect(geometry.toolbar.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(geometry.toolbar.width).toBeGreaterThan(0);
      expect(geometry.toolbarScrollWidth).toBeLessThanOrEqual(geometry.toolbarClientWidth + 1);
      for (const control of geometry.controls) {
        expect(
          control.width,
          `${control.label} misses the 44px touch target`,
        ).toBeGreaterThanOrEqual(44);
        expect(control.left, `${control.label} clipped at left edge`).toBeGreaterThanOrEqual(
          geometry.toolbar.left - 1,
        );
        expect(control.right, `${control.label} clipped at right edge`).toBeLessThanOrEqual(
          geometry.toolbar.right + 1,
        );
        expect(control.bottom, `${control.label} clipped below toolbar`).toBeLessThanOrEqual(
          geometry.toolbar.bottom + 1,
        );
      }
      for (const [index, launcher] of geometry.launchers.entries()) {
        const overlapsToolbar =
          launcher.left < geometry.toolbar.right &&
          launcher.right > geometry.toolbar.left &&
          launcher.top < geometry.toolbar.bottom &&
          launcher.bottom > geometry.toolbar.top;
        expect(overlapsToolbar, `panel launcher ${index} overlaps floating toolbar`).toBe(false);
      }
      expect(geometry.dock).not.toBeNull();
      expect(geometry.dock!.bottom - geometry.dock!.top).toBeLessThanOrEqual(40);
      expect(geometry.activeWorkspace).not.toBeNull();
      expect(geometry.activeWorkspace!.bottom - geometry.activeWorkspace!.top).toBe(32);
      for (const button of geometry.workspaceButtons) {
        expect(button.width).toBe(32);
        expect(button.bottom - button.top).toBe(32);
      }
      for (const handle of geometry.moveHandles) {
        expect(handle.width).toBeLessThanOrEqual(48);
        expect(handle.paintedWidth).toBe(28);
      }
      for (const action of geometry.panelActions) {
        expect(action.width).toBeLessThanOrEqual(44);
        expect(action.paintedWidth).toBe(28);
      }
      for (const action of geometry.layersHeaderButtons) {
        expect(action.width).toBeLessThanOrEqual(44);
        expect(action.paintedWidth).toBe(28);
      }
      const tabletControls = page.getByRole('button', { name: 'Tablet editing controls' });
      await tabletControls.click();
      const controlsPanel = page.getByRole('dialog', { name: 'Tablet editing controls' });
      await expect(controlsPanel).toBeVisible();
      const controlsPortalBox = await page.locator('.tablet-touch-controls__portal').boundingBox();
      expect(controlsPortalBox).not.toBeNull();
      const canvasBox = await page.locator('.editor-canvas').boundingBox();
      expect(canvasBox).not.toBeNull();
      expect(controlsPortalBox!.x).toBeGreaterThanOrEqual(canvasBox!.x - 1);
      expect(controlsPortalBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);
      expect(controlsPortalBox!.x + controlsPortalBox!.width).toBeLessThanOrEqual(
        canvasBox!.x + canvasBox!.width + 1,
      );
      expect(controlsPortalBox!.y + controlsPortalBox!.height).toBeLessThanOrEqual(
        canvasBox!.y + canvasBox!.height + 1,
      );
      expect(
        controlsPortalBox!.y + controlsPortalBox!.height,
        'editing controls must leave the floating toolbar reachable',
      ).toBeLessThanOrEqual(geometry.toolbar.top + 1);
      for (const [index, launcher] of geometry.launchers.entries()) {
        const overlaps =
          controlsPortalBox!.x < launcher.right &&
          controlsPortalBox!.x + controlsPortalBox!.width > launcher.left &&
          controlsPortalBox!.y < launcher.bottom &&
          controlsPortalBox!.y + controlsPortalBox!.height > launcher.top;
        expect(overlaps, `editing controls obscure panel launcher ${index}`).toBe(false);
      }
      const protectedRegions = await page.evaluate(() => {
        const rect = (element: Element) => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return ['.editor__layers-panel', '.editor__inspector-panel']
          .map((selector) => document.querySelector<HTMLElement>(selector))
          .filter((element): element is HTMLElement => Boolean(element))
          .filter((element) => {
            const style = getComputedStyle(element);
            const r = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0;
          })
          .map((element) => ({ selector: `.${element.classList[0]}`, ...rect(element) }));
      });
      for (const region of protectedRegions) {
        const overlaps =
          controlsPortalBox!.x < region.right &&
          controlsPortalBox!.x + controlsPortalBox!.width > region.left &&
          controlsPortalBox!.y < region.bottom &&
          controlsPortalBox!.y + controlsPortalBox!.height > region.top;
        expect(overlaps, `editing controls obscure essential ${region.selector}`).toBe(false);
      }
      const popoverLayer = await page.evaluate(() => {
        const portal = document.querySelector('.tablet-touch-controls__portal');
        if (!portal) throw new Error('missing tablet controls portal');
        return {
          tabletControls: Number.parseFloat(getComputedStyle(portal).zIndex),
          passiveTip: Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--z-toast'),
          ),
        };
      });
      expect(
        popoverLayer.tabletControls,
        'active tablet controls must paint above the passive onboarding tip',
      ).toBeGreaterThan(popoverLayer.passiveTip);
      await page.screenshot({
        path: test.info().outputPath(`tablet-toolbar-controls-open-${viewport.width}.png`),
      });
      const scrollResult = await page.evaluate(() => {
        const portal = document.querySelector<HTMLElement>('.tablet-touch-controls__portal');
        const guide = document.querySelector<HTMLElement>('.tablet-touch-controls__guide');
        if (!portal || !guide) throw new Error('missing tablet controls portal or gesture guide');
        portal.scrollTop = portal.scrollHeight;
        const viewport = portal.getBoundingClientRect();
        const rect = guide.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          scrollHeight: portal.scrollHeight,
          clientHeight: portal.clientHeight,
          guideWithinScrollport: rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1,
          hitBelongsToGuide: Boolean(hit && guide.contains(hit)),
          hitTag: hit?.tagName ?? null,
          hitClass: hit instanceof HTMLElement ? hit.className : null,
        };
      });
      expect(scrollResult.scrollHeight).toBeGreaterThan(0);
      expect(scrollResult.clientHeight).toBeGreaterThan(0);
      expect(
        scrollResult.guideWithinScrollport,
        'gesture guidance must be reachable by scrolling the bounded popover',
      ).toBe(true);
      expect(
        scrollResult.hitBelongsToGuide,
        `gesture guidance is obscured by ${scrollResult.hitTag}.${scrollResult.hitClass}`,
      ).toBe(true);
      expect(controlsPortalBox!.x).toBeGreaterThanOrEqual(-1);
      expect(controlsPortalBox!.y).toBeGreaterThanOrEqual(-1);
      expect(controlsPortalBox!.x + controlsPortalBox!.width).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect(controlsPortalBox!.y + controlsPortalBox!.height).toBeLessThanOrEqual(
        viewport.height + 1,
      );
      await page.screenshot({
        path: test.info().outputPath(`tablet-toolbar-controls-scrolled-${viewport.width}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(controlsPanel).toBeHidden();
      await page.screenshot({
        path: test.info().outputPath(`tablet-toolbar-${viewport.width}.png`),
      });
    });
  }
});
