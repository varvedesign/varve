/**
 * /try GoatCounter: consent, DNT/GPC, launch, export, and campaign refs.
 *
 * Always hits the Playwright Vite server with `?try=1`. This spec is not a
 * demo-dist owner; `VARVE_DEMO_DIST_URL` in other shards points at a host
 * that is not running here (CI refused those /try navigations).
 */
import { expect, type Page, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';

const COLLECTOR = /https:\/\/(.*\.goatcounter\.com|gc\.zgo\.at)\//;
const CONSENT_KEY = 'varve:website-analytics-consent:goatcounter-v1';

function demoUrl(search = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.set('try', '1');
  return `/?${params.toString()}`;
}

function collectorPath(url: string): string | null {
  return new URL(url).searchParams.get('p');
}

async function interceptCollector(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(COLLECTOR, async (route) => {
    requests.push(route.request().url());
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      status: 202,
      body: '',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  return requests;
}

async function waitForEditor(page: Page): Promise<void> {
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 120000 });
  const dialog = page.locator('dialog.crash-dialog[open]').first();
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog
      .getByRole('button', { name: /review my documents|close/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }
}

test.describe('browser demo GoatCounter', () => {
  test.describe.configure({ timeout: 240000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('sends nothing without stored consent', async ({ page }) => {
    const requests = await interceptCollector(page);
    await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await page.waitForTimeout(400);
    expect(requests).toEqual([]);
  });

  test('sends nothing when consent is denied', async ({ page }) => {
    const requests = await interceptCollector(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'denied'), CONSENT_KEY);
    await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await page.waitForTimeout(400);
    expect(requests).toEqual([]);
  });

  for (const signal of ['globalPrivacyControl', 'doNotTrack'] as const) {
    test(`sends nothing when ${signal} is set, even with a stored grant`, async ({ page }) => {
      const requests = await interceptCollector(page);
      await page.addInitScript(
        ({ key, name }) => {
          Object.defineProperty(navigator, name, {
            configurable: true,
            value: name === 'globalPrivacyControl' ? true : '1',
          });
          localStorage.setItem(key, 'granted');
        },
        { key: CONSENT_KEY, name: signal },
      );
      await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
      await waitForEditor(page);
      await page.waitForTimeout(400);
      expect(requests).toEqual([]);
    });
  }

  test('sends the launch event once when Allow is clicked mid-session', async ({ page }) => {
    const requests = await interceptCollector(page);
    await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expect(page.locator('.varve-demo-banner__consent')).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect
      .poll(() => requests.map(collectorPath), { timeout: 10000 })
      .toContain('demo-launch-direct');
    expect(
      requests.map(collectorPath).filter((path) => path === 'demo-launch-direct'),
    ).toHaveLength(1);
  });

  test('sends one launch event after a stored grant', async ({ page }) => {
    const requests = await interceptCollector(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'granted'), CONSENT_KEY);
    await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expect
      .poll(() => requests.map(collectorPath), { timeout: 10000 })
      .toEqual(expect.arrayContaining(['try', 'demo-launch-direct']));
    expect(
      requests.map(collectorPath).filter((path) => path === 'demo-launch-direct'),
    ).toHaveLength(1);
    for (const url of requests) {
      expect(url).not.toMatch(/filename|layer|document|\.varve/i);
    }
  });

  test('keeps hn-post and drops an unknown ref', async ({ page }) => {
    const kept: string[] = [];
    const dropped: string[] = [];
    await page.route(COLLECTOR, async (route) => {
      const url = route.request().url();
      if (page.url().includes('ref=hn-post')) kept.push(url);
      else dropped.push(url);
      await route.fulfill({
        status: 202,
        body: '',
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.addInitScript((key) => localStorage.setItem(key, 'granted'), CONSENT_KEY);

    await page.goto(demoUrl('?ref=hn-post'), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expect
      .poll(() => kept.map(collectorPath), { timeout: 10000 })
      .toContain('try?ref=hn-post');

    await page.goto(demoUrl('?ref=evil'), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expect.poll(() => dropped.map(collectorPath), { timeout: 10000 }).toContain('try');
    expect(dropped.join('\n')).not.toContain('evil');
    expect(dropped.map(collectorPath)).not.toContain('try?ref=evil');
  });

  test('exporting PNG and SVG sends format-only events', async ({ page }) => {
    const requests = await interceptCollector(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'granted'), CONSENT_KEY);
    await page.goto(demoUrl(), { waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expect
      .poll(() => requests.map(collectorPath), { timeout: 10000 })
      .toContain('demo-launch-direct');

    const layer = page.getByRole('treeitem').filter({ hasText: 'Sun' }).first();
    await layer.click();
    await selectInspectorTab(page, 'Export');
    await page.getByRole('button', { name: /Download (PNG|SVG|JPEG|WebP)/ }).waitFor({
      timeout: 30000,
    });
    await page
      .getByRole('radiogroup', { name: 'Export format', exact: true })
      .getByRole('radio', { name: 'PNG', exact: true })
      .check();
    const pngDownload = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /Download PNG/i }).click();
    await pngDownload;
    await expect
      .poll(() => requests.map(collectorPath), { timeout: 10000 })
      .toContain('demo-export-png');

    await page
      .getByRole('radiogroup', { name: 'Export format', exact: true })
      .getByRole('radio', { name: 'SVG', exact: true })
      .check();
    const svgDownload = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: /Download SVG/i }).click();
    await svgDownload;
    await expect
      .poll(() => requests.map(collectorPath), { timeout: 10000 })
      .toContain('demo-export-svg');

    for (const url of requests) {
      expect(url).not.toMatch(/Sun|Poster|filename|layer|\.varve/i);
      const path = new URL(url).searchParams.get('p') ?? '';
      expect(path).not.toMatch(/^\//);
      expect(path).not.toMatch(/\.(png|svg|jpeg|webp)$/i);
    }
  });
});
