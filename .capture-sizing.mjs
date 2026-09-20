#!/usr/bin/env node
/**
 * Exploratory sizing capture: screenshots + computed-style measurements of the
 * real editor. Read-only against the repo; writes only to /tmp/opencode/shots.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.VARVE_BASE ?? 'http://localhost:1420';
const OUT = '/tmp/opencode/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

async function nav() {
  await page.goto(BASE, { timeout: 300000, waitUntil: 'domcontentloaded' });
  const inSafeMode = await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 300000 });
  }
  const recovery = page.locator('dialog[open]').filter({ hasText: /closed unexpectedly|recover your documents/i });
  if ((await recovery.count()) > 0) {
    await recovery.getByRole('button', { name: /review my documents/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 60000 });
  await newBtn.click({ force: true, timeout: 15000 });
  const createInDialog = page.locator('dialog[open]').getByRole('button', { name: /^create(\s+design)?$/i }).first();
  await createInDialog.waitFor({ timeout: 45000 });
  await createInDialog.click({ timeout: 15000 });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const topmost = openDialogs.last();
    const close = topmost.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ timeout: 5000 }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500);
}

await nav();
await page.screenshot({ path: `${OUT}/01-editor-full.png` });

// --- Measure interface typography + control geometry across the shell ---
const measurements = await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  const pick = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const text = (el.textContent ?? '').trim().slice(0, 40);
    const key = `${el.className}|${cs.fontSize}|${cs.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
      text,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.split(',')[0].replace(/"/g, ''),
      color: cs.color,
      box: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) },
    });
  };
  const roots = ['.editor-shell', '.menubar', '.status-bar', '.layers-panel', '.editor-tabs', '[class*="inspector"]'];
  for (const sel of roots) {
    const root = document.querySelector(sel);
    if (!root) continue;
    pick(root);
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length === 0 && (el.textContent ?? '').trim()) pick(el);
    }
  }
  // controls
  for (const el of document.querySelectorAll('button, input, select, [role="button"], [role="tab"]')) pick(el);
  return out;
});
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));

// --- Root token readout ---
const tokens = await page.evaluate(() => {
  const names = [
    '--font-size-2xs', '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg',
    '--type-interface-control-size', '--type-interface-label-size', '--type-interface-body-size',
    '--type-interface-caption-size', '--type-interface-title-size',
    '--component-compact-height', '--component-default-height', '--component-large-height',
    '--density-rows-min-height', '--density-control-size', '--menu-item-min-height', '--tab-min-height',
  ];
  const cs = getComputedStyle(document.documentElement);
  const density = document.documentElement.dataset.density ?? '(none)';
  const root = {};
  for (const n of names) root[n] = cs.getPropertyValue(n).trim();
  return { density, rootFontSize: cs.fontSize, tokens: root };
});
writeFileSync(`${OUT}/tokens.json`, JSON.stringify(tokens, null, 2));

// --- Select a frame -> inspector ---
try {
  await page.locator('.layers-panel').waitFor({ timeout: 8000 });
  const frameRow = page.locator('.layers-panel [role="treeitem"], .layers-panel .layer-row').first();
  if (await frameRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await frameRow.click({ timeout: 5000 });
    await page.waitForTimeout(800);
  }
} catch { /* best effort */ }
await page.screenshot({ path: `${OUT}/02-inspector.png` });
const inspector = await page.locator('[class*="inspector"]').first();
if (await inspector.isVisible({ timeout: 2000 }).catch(() => false)) {
  await inspector.screenshot({ path: `${OUT}/03-inspector-panel.png` }).catch(() => {});
}

// --- Zoom crops for close inspection ---
await page.screenshot({ path: `${OUT}/04-statusbar.png`, clip: { x: 0, y: 1052, width: 1920, height: 28 } });
await page.screenshot({ path: `${OUT}/05-menubar.png`, clip: { x: 0, y: 0, width: 1920, height: 60 } });

// --- Inspector layout measurements ---
const inspectorGeometry = await page.evaluate(() => {
  const panel = document.querySelector('[class*="inspector"]');
  if (!panel) return null;
  const rows = [];
  for (const el of panel.querySelectorAll('label, input, select, button, [class*="field"], [class*="row"], [class*="section"], h2, h3, [role="heading"], [class*="heading"]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
      text: (el.textContent ?? '').trim().slice(0, 30),
      fontSize: cs.fontSize,
      textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      fontWeight: cs.fontWeight,
      h: Math.round(r.height),
      w: Math.round(r.width),
      align: cs.textAlign,
    });
  }
  return rows;
});
writeFileSync(`${OUT}/inspector-geometry.json`, JSON.stringify(inspectorGeometry, null, 2));

await browser.close();
console.log('captured to', OUT);
