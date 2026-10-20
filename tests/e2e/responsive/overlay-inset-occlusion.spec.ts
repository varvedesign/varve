/**
 * Bottom-anchored overlay chrome must not cover interface controls.
 *
 * The `.editor-shell` inset recipe (`--overlay-bottom-inset`,
 * `--overlay-left-inset`, `--overlay-right-inset`) is what keeps the
 * "Did You Know?" tip, the onboarding checklist, micro-hints and the import
 * progress panel clear of the docked rails, the status bar, an on-screen
 * keyboard and a standalone PWA's gesture bar. The companion source-level guard
 * is `tests/unit/overlay-inset-system.test.ts`; this spec proves the resolved
 * geometry in the real editor.
 *
 * The tip is driven by a 15-second idle timer, so the tip half of this spec
 * waits for it explicitly instead of racing it — the earlier broad sweep in
 * `tests/e2e/responsive/dock-panels.spec.ts` only caught it intermittently,
 * which is exactly why that sweep surfaced a real defect as a flake.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface OverlayGeometry {
  viewport: { w: number; h: number };
  insets: { left: number; right: number; bottom: number };
  layersRight: number | null;
  inspectorLeft: number | null;
  statusbarTop: number | null;
  floatingToolbarTop: number | null;
  tip: { left: number; right: number; top: number; bottom: number } | null;
  tipBottom: string;
  tipRight: string;
  coveredControls: string[];
}

/**
 * Resolve the shell's overlay insets to used pixels.
 *
 * A custom property computes to its own token text, not to a length, so the
 * only faithful way to read the resolved value is to apply it to an element
 * that inherits it and read the resulting used offset.
 */
async function measureOverlays(page: import('@playwright/test').Page): Promise<OverlayGeometry> {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.editor-shell');
    if (!shell) throw new Error('missing .editor-shell');

    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;' +
      'top:0;right:var(--overlay-right-inset);bottom:var(--overlay-bottom-inset);' +
      'left:var(--overlay-left-inset);';
    shell.appendChild(probe);
    const probeStyle = getComputedStyle(probe);
    const insets = {
      left: Number.parseFloat(probeStyle.left),
      right: Number.parseFloat(probeStyle.right),
      bottom: Number.parseFloat(probeStyle.bottom),
    };
    probe.remove();

    const rectOf = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };

    const layers = document.querySelector('.editor__layers-panel');
    const inspector = document.querySelector('.editor__inspector-panel');
    const statusbar = document.querySelector('.editor-status');
    const floatingToolbar = document.querySelector('.floating-toolbar');

    const tipEl = document.querySelector<HTMLElement>('.did-you-know-tip');
    const tip = tipEl ? rectOf(tipEl) : null;
    const tipStyle = tipEl ? getComputedStyle(tipEl) : null;

    const coveredControls: string[] = [];
    if (tip) {
      for (const root of [inspector, layers]) {
        if (!root) continue;
        const candidates = root.querySelectorAll<HTMLElement>(
          'button, input, select, [role="button"], [role="slider"], [role="spinbutton"], [tabindex="0"]',
        );
        for (const element of candidates) {
          const r = element.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          // Only a control whose own centre falls inside the tip can be hidden.
          if (cx < tip.left || cx > tip.right || cy < tip.top || cy > tip.bottom) continue;
          const hit = document.elementFromPoint(cx, cy);
          if (!hit || hit === element || element.contains(hit)) continue;
          const label =
            element.getAttribute('aria-label') ??
            element.textContent?.trim().slice(0, 40) ??
            element.tagName.toLowerCase();
          coveredControls.push(`${element.className || element.tagName} "${label}"`);
        }
      }
    }

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      insets,
      layersRight: layers ? layers.getBoundingClientRect().right : null,
      inspectorLeft: inspector ? inspector.getBoundingClientRect().left : null,
      statusbarTop: statusbar ? statusbar.getBoundingClientRect().top : null,
      floatingToolbarTop: floatingToolbar ? floatingToolbar.getBoundingClientRect().top : null,
      tip,
      tipBottom: tipStyle?.bottom ?? '',
      tipRight: tipStyle?.right ?? '',
      coveredControls,
    };
  });
}

/** Wait for the idle-timer tip rather than racing it. */
async function waitForTip(page: import('@playwright/test').Page, budget = 30_000): Promise<void> {
  await page.locator('.did-you-know-tip').first().waitFor({ state: 'visible', timeout: budget });
}

test.describe('overlay inset contract', () => {
  test('the shell insets clear both docked rails and the status bar', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    await expect(page.locator('.editor-shell')).toBeVisible();

    const geometry = await measureOverlays(page);
    console.log(`OVERLAY-INSETS ${JSON.stringify(geometry, null, 1)}`);

    // A right-anchored surface starts at `viewport - rightInset`, so clearing
    // the Inspector means the inset is at least as wide as the rail.
    const inspectorWidth =
      geometry.inspectorLeft === null ? 0 : geometry.viewport.w - geometry.inspectorLeft;
    expect(
      geometry.insets.right,
      `right inset ${geometry.insets.right}px must clear the ${inspectorWidth}px Inspector rail`,
    ).toBeGreaterThanOrEqual(inspectorWidth - 1);

    const layersWidth = geometry.layersRight ?? 0;
    expect(
      geometry.insets.left,
      `left inset ${geometry.insets.left}px must clear the ${layersWidth}px Layers rail`,
    ).toBeGreaterThanOrEqual(layersWidth - 1);

    const statusbarHeight =
      geometry.statusbarTop === null ? 0 : geometry.viewport.h - geometry.statusbarTop;
    expect(
      geometry.insets.bottom,
      `bottom inset ${geometry.insets.bottom}px must clear the ${statusbarHeight}px status bar`,
    ).toBeGreaterThanOrEqual(statusbarHeight - 1);

    await page.screenshot({ path: 'test-results/overlay-inset-shell-1280x800.png' });
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 800 },
  ]) {
    test(`the onboarding tip covers no rail control at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(viewport);
      await navigateToEditor(page);
      await expect(page.locator('.editor-shell')).toBeVisible();

      await waitForTip(page);
      const geometry = await measureOverlays(page);
      console.log(
        `OVERLAY-TIP ${viewport.width}x${viewport.height} ${JSON.stringify(geometry, null, 1)}`,
      );

      expect(geometry.tip, 'tip geometry').not.toBeNull();
      expect(geometry.floatingToolbarTop, 'floating toolbar geometry').not.toBeNull();
      expect(
        geometry.tip!.bottom,
        `tip bottom ${geometry.tip!.bottom} must clear floating toolbar at ${geometry.floatingToolbarTop}`,
      ).toBeLessThanOrEqual(geometry.floatingToolbarTop! - 8);
      // The tip consumes the contract rather than a private offset.
      expect(geometry.tipBottom).not.toBe('');
      expect(geometry.tipRight).not.toBe('');
      expect(
        geometry.coveredControls,
        `controls hidden under the tip: ${geometry.coveredControls.join('; ')}`,
      ).toEqual([]);
      if (geometry.inspectorLeft !== null) {
        expect(
          geometry.tip!.right,
          `tip right edge ${geometry.tip!.right} must not cross the Inspector at ${geometry.inspectorLeft}`,
        ).toBeLessThanOrEqual(geometry.inspectorLeft + 1);
      }
      if (geometry.layersRight !== null) {
        expect(
          geometry.tip!.left,
          `tip left edge ${geometry.tip!.left} must stay right of the Layers rail at ${geometry.layersRight}`,
        ).toBeGreaterThanOrEqual(geometry.layersRight - 1);
      }

      await page.screenshot({
        path: `test-results/overlay-inset-tip-${viewport.width}x${viewport.height}.png`,
      });
    });
  }

  test('the onboarding tip stays inside the viewport at 200% text', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 900, height: 800 });
    await navigateToEditor(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    await waitForTip(page);
    const geometry = await measureOverlays(page);
    console.log(`OVERLAY-TIP-200 ${JSON.stringify(geometry, null, 1)}`);

    const tip = geometry.tip!;
    expect(tip, 'tip geometry').not.toBeNull();
    expect(geometry.floatingToolbarTop, 'floating toolbar geometry').not.toBeNull();
    expect(
      tip.bottom,
      `tip bottom ${tip.bottom} must clear floating toolbar at ${geometry.floatingToolbarTop}`,
    ).toBeLessThanOrEqual(geometry.floatingToolbarTop! - 8);
    // At an enlarged root text size the tip's rem-based floor used to exceed the
    // space beside the rail and push it off the left edge.
    expect(tip.left, `tip left ${tip.left} must not be negative`).toBeGreaterThanOrEqual(-1);
    expect(
      tip.right,
      `tip right ${tip.right} must stay inside the ${geometry.viewport.w}px viewport`,
    ).toBeLessThanOrEqual(geometry.viewport.w + 1);
    expect(tip.top, `tip top ${tip.top} must not be negative`).toBeGreaterThanOrEqual(-1);
    expect(
      tip.bottom,
      `tip bottom ${tip.bottom} must stay inside the ${geometry.viewport.h}px viewport`,
    ).toBeLessThanOrEqual(geometry.viewport.h + 1);
    expect(
      geometry.coveredControls,
      `controls hidden under the tip: ${geometry.coveredControls.join('; ')}`,
    ).toEqual([]);
    await page.screenshot({ path: 'test-results/overlay-inset-tip-900x800-200percent.png' });
  });
});
