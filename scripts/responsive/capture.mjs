/**
 * Playwright capture + assertions for the responsive validation harness.
 *
 * The editor is loaded once, one document is created, and the same page is
 * resized through the matrix (no reload per viewport). Assertion failures are
 * collected per viewport; nothing throws on the first failing check.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { buildEditorChecks, checkPillReachability, probeEditorLayout } from './editorProbe.mjs';
import { editorScreenshotName, websiteScreenshotName } from './matrix.mjs';

/** Cold vite transform can take minutes on the first load. */
export const READY_TIMEOUT_MS = 180000;

/** Launch a browser; one instance is shared by the editor and website runs. */
export async function launchBrowser() {
  return chromium.launch();
}

/** Dismiss stacked startup dialogs and the onboarding checklist. */
async function dismissStartupSurfaces(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialogs = page.locator('dialog[open]');
    if ((await dialogs.count()) === 0) break;
    const close = dialogs.last().getByRole('button', { name: /^(close|cancel|got it|skip)$/i });
    if (
      await close
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false)
    ) {
      await close
        .first()
        .click({ timeout: 3000, force: true })
        .catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  const onboarding = page.locator('.onboarding-checklist__dismiss');
  if (await onboarding.isVisible({ timeout: 800 }).catch(() => false)) {
    await onboarding.click({ timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}

/** Load the editor home, create one document, and keep it open for the matrix. */
async function openEditorPage(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
    const newButton = page.getByRole('button', { name: /^new$/i });
    await newButton.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);
    await newButton.click({ timeout: 60000 });
    const createButton = page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create(\s+design)?$/i })
      .first();
    await createButton.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
    await createButton.click({ timeout: 60000 });
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
    await dismissStartupSurfaces(page);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Editor matrix capture. Returns { rows, checks, screenshots, pageErrors }. */
export async function captureEditor({ browser, url, outDir, viewports, screenshots }) {
  if (screenshots) mkdirSync(path.join(outDir, 'editor'), { recursive: true });
  const { context, page } = await openEditorPage(browser, url);
  const rows = [];
  const checks = [];
  const shotPaths = [];
  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(600);
      const defaultShot = editorScreenshotName(viewport, 'default');
      if (screenshots) {
        await page.screenshot({ path: path.join(outDir, defaultShot), animations: 'disabled' });
        shotPaths.push(defaultShot);
      }
      const measurement = await page.evaluate(probeEditorLayout);
      const reachability = await checkPillReachability(page, measurement);
      checks.push(...buildEditorChecks(measurement, viewport, reachability));
      const row = {
        label: viewport.label,
        screenshot: screenshots ? defaultShot : null,
        ...measurement,
        pills: {
          count: measurement.pills.length,
          reachable: measurement.pills.length - reachability.unreachable.length,
          unreachable: reachability.unreachable,
        },
      };
      const fab = page.locator('.editor__fab--layers');
      if (await fab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await fab.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        const layersShot = editorScreenshotName(viewport, 'layers');
        if (screenshots) {
          await page.screenshot({ path: path.join(outDir, layersShot), animations: 'disabled' });
          shotPaths.push(layersShot);
          row.layersScreenshot = layersShot;
        }
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
      rows.push(row);
    }
  } finally {
    await context.close();
  }
  return { rows, checks, screenshots: shotPaths };
}

/** Serialized into the page: website document and viewport geometry. */
/** Website matrix capture (full-page screenshots are required here). */
export async function captureWebsite({ browser, baseUrl, outDir, viewports, routes, screenshots }) {
  if (screenshots) mkdirSync(path.join(outDir, 'website'), { recursive: true });
  const first = viewports[0];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const rows = [];
  const checks = [];
  const shotPaths = [];
  const addCheck = (route, viewport, id, pass, expected, measured) =>
    checks.push({
      app: 'website',
      route: route.route,
      viewport: viewport.label,
      id,
      pass,
      expected,
      measured,
    });
  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto(new URL(route.route, baseUrl).toString(), {
          waitUntil: 'load',
          timeout: 60000,
        });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        const measurement = await page.evaluate(() => ({
          doc: {
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
          },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }));
        const shot = websiteScreenshotName(viewport, route);
        if (screenshots) {
          await page.screenshot({
            path: path.join(outDir, shot),
            fullPage: true,
            animations: 'disabled',
          });
          shotPaths.push(shot);
        }
        const status = response === null ? null : response.status();
        addCheck(route, viewport, 'website.route-status', status === 200, 'HTTP 200', { status });
        addCheck(
          route,
          viewport,
          'website.page-overflow',
          measurement.doc.scrollWidth <= measurement.viewport.width + 1,
          'documentElement.scrollWidth <= innerWidth + 1',
          {
            scrollWidth: measurement.doc.scrollWidth,
            innerWidth: measurement.viewport.width,
            clientWidth: measurement.doc.clientWidth,
            scrollHeight: measurement.doc.scrollHeight,
          },
        );
        rows.push({
          label: viewport.label,
          route: route.route,
          slug: route.slug,
          status,
          screenshot: screenshots ? shot : null,
          ...measurement,
        });
      }
    }
  } finally {
    await context.close();
  }
  return { rows, checks, screenshots: shotPaths };
}
