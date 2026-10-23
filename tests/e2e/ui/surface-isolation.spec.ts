/**
 * E2E: one surface's render failure must not take the whole app down.
 *
 * PDFCraft #3914 ("the per-frame UI has no panic guard, so any UI panic closes
 * the app with every tab") describes a containment failure, not a specific
 * widget bug. Varve wraps the canvas, layers and inspector in independent
 * `ErrorBoundary` instances keyed by document, so a throw inside one renders
 * that surface's alert while the rest of the shell keeps working.
 *
 * The throw is injected through the dev/test-only `window.__varveSurfaceFault`
 * hook (the same build gate as the crash test hooks) *after* the editor has
 * mounted, then a workspace switch forces a re-render. A passing run proves
 * containment in a real browser: the fallback appears in exactly one panel,
 * the other panels stay usable, and the failed panel recovers on Reload.
 *
 * Native gap: a Rust panic in the Tauri process is outside the DOM boundary's
 * reach; it is recorded as a platform limitation in the closure, not claimed
 * here.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type FaultWindow = Window & { __varveSurfaceFault?: string };

async function injectSurfaceFault(page: Page, surface: string) {
  await page.evaluate((name) => {
    (window as FaultWindow).__varveSurfaceFault = name;
  }, surface);
  // Any editor state change re-renders the shell, which re-renders the
  // boundary and lets its probe observe the injected fault.
  await page.getByRole('radio', { name: 'Print workspace' }).click();
  await page.getByRole('radio', { name: 'Design workspace' }).click();
}

async function clearSurfaceFault(page: Page) {
  await page.evaluate(() => {
    delete (window as FaultWindow).__varveSurfaceFault;
  });
}

test.describe('per-surface panic isolation', () => {
  test('an inspector render panic leaves the canvas, layers and menubar usable', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await injectSurfaceFault(page, 'inspector');

    const inspectorAlert = page.locator('#editor-inspector-panel [role="alert"]');
    await expect(inspectorAlert).toContainText('Something went wrong');
    await expect(inspectorAlert).toContainText('synthetic inspector surface failure');

    // Exactly one boundary failed, and the neighbours are alive: the canvas
    // still paints and the menubar still opens a menu.
    await expect(page.locator('.error-boundary[role="alert"]')).toHaveCount(1);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toBeVisible();
    await expect(page.locator('.layers-panel')).toBeVisible();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Recover the surface the way a user would, after the transient fault is
    // gone: the boundary drops the captured error and remounts its children.
    await clearSurfaceFault(page);
    await inspectorAlert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.locator('#editor-inspector-panel [role="alert"]')).toHaveCount(0);
    await expect(
      page.locator('#editor-inspector-panel').getByRole('tablist', { name: /inspector/i }),
    ).toBeVisible();
  });

  test('a canvas render panic leaves the inspector and layers usable', async ({ page }) => {
    await navigateToEditor(page);
    await injectSurfaceFault(page, 'canvas');

    // The boundary's fallback replaces CanvasArea inside the canvas dock, so
    // the failed surface is the dock, not the (now absent) canvas element.
    const canvasAlert = page.locator('.editor-shell__canvas-dock [role="alert"]');
    await expect(canvasAlert).toContainText('Something went wrong');
    await expect(page.locator('.error-boundary[role="alert"]')).toHaveCount(1);

    // Panels are independent of the failed surface.
    await expect(page.locator('.layers-panel')).toBeVisible();
    await expect(
      page.locator('#editor-inspector-panel').getByRole('tablist', { name: /inspector/i }),
    ).toBeVisible();
    await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await clearSurfaceFault(page);
    await canvasAlert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.locator('.editor-shell__canvas-dock [role="alert"]')).toHaveCount(0);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toBeVisible();
  });
});
