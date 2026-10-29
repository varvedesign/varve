/**
 * Compact header containment (2026-10-29).
 *
 * The second header row places the ContextControlBar beside the Share
 * button. The context bar has its own horizontal scroller for selection
 * controls wider than the window, but its component stylesheet sets
 * `flex-shrink: 0`, so inside the row it was content-sized instead of
 * shrinking: at 320-390 CSS px the last tool pills and Share painted past the
 * viewport and the shell's `overflow: clip` hid them with no scroller to reach
 * them (no document scroll, no internal scroll).
 *
 * These tests pin the containment contract, not the implementation: every
 * context tool must be reachable (inside the viewport, or reachable by
 * scrolling its own bar), Share must stay inside the viewport and
 * hit-testable, and no width may introduce page-level horizontal overflow.
 * Desktop keeps the unshrunken bar.
 */

import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const COMPACT_VIEWPORTS = [
  { label: '320x640', width: 320, height: 640 },
  { label: '375x667', width: 375, height: 667 },
  { label: '390x844', width: 390, height: 844 },
  { label: '480x640', width: 480, height: 640 },
  { label: '768x1024', width: 768, height: 1024 },
] as const;

interface HeaderMetrics {
  viewportWidth: number;
  documentScrollWidth: number;
  headerRow: { left: number; right: number } | null;
  contextBar: { clientWidth: number; scrollWidth: number } | null;
}

async function readHeaderMetrics(page: Page): Promise<HeaderMetrics> {
  return page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    const contextBar = document.querySelector('.context-control-bar');
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      headerRow: rect(document.querySelector('.editor-shell__header-row')),
      contextBar: contextBar
        ? { clientWidth: contextBar.clientWidth, scrollWidth: contextBar.scrollWidth }
        : null,
    };
  });
}

/** A pointer at the control's centre must hit the control (or its child icon). */
function isHitTestable(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && element.contains(hit);
  });
}

/** Share is a direct header-row button; keep it inside the viewport and clickable. */
async function expectShareReachable(page: Page, metrics: HeaderMetrics, label: string) {
  expect(metrics.documentScrollWidth, `document overflow at ${label}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.headerRow, `header row missing at ${label}`).not.toBeNull();
  const share = page.getByRole('button', { name: 'Share', exact: true });
  await expect(share, `Share missing at ${label}`).toBeVisible();
  const box = await share.boundingBox();
  expect(box, `Share has no box at ${label}`).not.toBeNull();
  expect(box?.x ?? -1, `Share starts off-screen at ${label}`).toBeGreaterThanOrEqual(0);
  expect(box?.x ?? 0, `Share starts off-screen at ${label}`).toBeLessThan(metrics.viewportWidth);
  expect(
    (box?.x ?? 0) + (box?.width ?? 0),
    `Share ends off-screen at ${label}`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(await isHitTestable(share), `Share is covered at ${label}`).toBe(true);
}

async function expectEveryToolReachable(page: Page, label: string) {
  const tools = page.locator('.context-control-bar .ccb__tool-pill');
  const count = await tools.count();
  expect(count, `no context tools rendered at ${label}`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const tool = tools.nth(index);
    await tool.scrollIntoViewIfNeeded();
    await expect(tool, `tool ${index} not visible at ${label}`).toBeVisible();
    expect(await isHitTestable(tool), `tool ${index} unreachable at ${label}`).toBe(true);
  }
}

test.describe('compact header containment', () => {
  test('keeps every context tool and Share reachable while compact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToEditor(page);
    for (const viewport of COMPACT_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(150);
      const metrics = await readHeaderMetrics(page);
      await expectShareReachable(page, metrics, viewport.label);
      await expectEveryToolReachable(page, viewport.label);
    }
  });

  test('leaves the desktop header row unshrunken at 1366x1024', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await navigateToEditor(page);
    const metrics = await readHeaderMetrics(page);
    await expectShareReachable(page, metrics, '1366x1024');
    expect(metrics.contextBar, 'context bar missing at 1366x1024').not.toBeNull();
    // Desktop has room: the bar must not be internally scrolling at this size.
    expect(metrics.contextBar?.scrollWidth ?? 0).toBeLessThanOrEqual(
      (metrics.contextBar?.clientWidth ?? 0) + 1,
    );
    await expectEveryToolReachable(page, '1366x1024');
  });
});
