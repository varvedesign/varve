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

/** Serialized into the page: editor shell geometry for one viewport. */
function probeEditorLayout() {
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (element) => {
    if (!element) return null;
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left: round(left), top: round(top), right: round(right), bottom: round(bottom) };
  };
  const inside = (rect) =>
    rect !== null &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= window.innerWidth + 1 &&
    rect.bottom <= window.innerHeight + 1;
  const hitAt = (element, rect) => {
    if (!element || rect === null) return false;
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit === element || (hit !== null && element.contains(hit));
  };
  const scrollOf = (element) => {
    if (!element) return null;
    const { scrollWidth, clientWidth } = element;
    return {
      scrollWidth,
      clientWidth,
      scrollable: scrollWidth > clientWidth + 1,
      overflowX: window.getComputedStyle(element).overflowX,
    };
  };
  const labelOf = (element) =>
    (element.getAttribute('aria-label') || element.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  const headerRow = document.querySelector('.editor-shell__header-row');
  const share = headerRow?.querySelector('.collab-header-control, .varve-btn');
  const bar = document.querySelector('.context-control-bar');
  const shareRect = rectOf(share);
  const barRect = rectOf(bar);
  const pills = [...document.querySelectorAll('.context-control-bar .ccb__tool-pill')].map(
    (pill, index) => {
      const rect = rectOf(pill);
      return { index, label: labelOf(pill), rect, inside: inside(rect), hit: hitAt(pill, rect) };
    },
  );
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    shell: rectOf(document.querySelector('.editor-shell')),
    headerRow: rectOf(headerRow),
    share: { rect: shareRect, inside: inside(shareRect), hit: hitAt(share, shareRect) },
    contextBar: { rect: barRect, inside: inside(barRect), ...(scrollOf(bar) || {}) },
    pills,
    internalScroll: {
      status: scrollOf(document.querySelector('.editor-status')),
      menubarLeft: scrollOf(document.querySelector('.editor-menubar__left')),
    },
  };
}

/** Scroll one context-bar pill into view, wait, then re-measure it. */
async function scrollPillIntoView(page, index) {
  return page.evaluate(async (pillIndex) => {
    const round = (value) => Math.round(value * 10) / 10;
    const pill = document.querySelectorAll('.context-control-bar .ccb__tool-pill')[pillIndex];
    if (!pill) return null;
    pill.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const rect = pill.getBoundingClientRect();
    const inside =
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      left: round(rect.left),
      inside,
      hit: hit === pill || (hit !== null && pill.contains(hit)),
    };
  }, index);
}

/** Measure pill reachability, scrolling the bar only when it can scroll. */
async function checkPillReachability(page, measurement) {
  const unreachable = [];
  let scrolledIntoSight = 0;
  const bar = measurement.contextBar;
  for (const pill of measurement.pills) {
    if (pill.inside && pill.hit) continue;
    if (!bar.scrollable || !bar.inside) {
      unreachable.push({
        label: pill.label,
        left: pill.rect === null ? null : pill.rect.left,
        viaScroll: false,
        reason: 'context bar box exceeds the viewport',
      });
      continue;
    }
    const after = await scrollPillIntoView(page, pill.index);
    if (after?.inside && after.hit) scrolledIntoSight += 1;
    else
      unreachable.push({
        label: pill.label,
        left: after === null ? null : after.left,
        viaScroll: true,
        reason: 'still unreachable after scrolling the context bar',
      });
  }
  await page.evaluate(() => {
    const bar = document.querySelector('.context-control-bar');
    if (bar) bar.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(120);
  return { unreachable, scrolledIntoSight };
}

/** Per-viewport editor assertions. */
function buildEditorChecks(measurement, viewport, reachability) {
  const { width, height } = measurement.viewport;
  const { shell, headerRow, share } = measurement;
  const pills = measurement.pills;
  const unreachable = reachability.unreachable;
  const record = (id, pass, expected, measured, detail) => ({
    app: 'editor',
    viewport: viewport.label,
    id,
    pass,
    expected,
    measured,
    ...(detail ? { detail } : {}),
  });
  return [
    record(
      'editor.page-overflow',
      measurement.doc.scrollWidth <= width + 1,
      'documentElement.scrollWidth <= innerWidth + 1',
      { scrollWidth: measurement.doc.scrollWidth, innerWidth: width },
    ),
    record(
      'editor.shell-bounds',
      shell !== null &&
        shell.left >= -1 &&
        shell.top >= -1 &&
        shell.right <= width + 1 &&
        shell.bottom <= height + 1,
      'editor-shell bounding box inside the viewport',
      { shell },
    ),
    record(
      'editor.header-row-right',
      headerRow !== null && headerRow.right <= width + 1,
      'editor-shell__header-row right edge <= innerWidth + 1',
      { headerRow },
    ),
    record(
      'editor.share-bounds',
      share.rect !== null && share.rect.left >= -1 && share.rect.right <= width + 1,
      'collab-header-control right edge <= innerWidth + 1',
      { share: share.rect, innerWidth: width },
    ),
    record(
      'editor.share-hit',
      share.hit,
      'elementFromPoint at collab-header-control centre hits it or a descendant',
      { share: share.rect, hit: share.hit },
    ),
    record(
      'editor.context-pills-present',
      pills.length > 0,
      'at least one context-control-bar tool pill rendered',
      { count: pills.length },
    ),
    record(
      'editor.context-pills-reachable',
      unreachable.length === 0,
      'every ccb__tool-pill reachable in the viewport',
      {
        total: pills.length,
        reachable: pills.length - unreachable.length,
        scrolledIntoSight: reachability.scrolledIntoSight,
        unreachable,
      },
      unreachable.map((pill) => pill.label).join(', '),
    ),
  ];
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
