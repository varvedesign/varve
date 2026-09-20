#!/usr/bin/env node
/**
 * Capture pass 2: dialogs, effect-parameter popovers, dark theme, narrow rail,
 * enlarged root font. Read-only against the repo; writes to /tmp/opencode/shots2.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.VARVE_BASE ?? 'http://localhost:1420';
const OUT = '/tmp/opencode/shots2';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

async function nav() {
  await page.goto(BASE, { timeout: 300000, waitUntil: 'domcontentloaded' });
  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 300000 });
  }
  const recovery = page.locator('dialog[open]').filter({ hasText: /closed unexpectedly|recover your documents/i });
  if ((await recovery.count()) > 0) {
    await recovery.getByRole('button', { name: /review my documents/i }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 60000 });
  const createInDialog = page.locator('dialog[open]').getByRole('button', { name: /^create(\s+design)?$/i }).first();
  await createInDialog.waitFor({ timeout: 45000 });
  await createInDialog.click({ timeout: 15000 });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 60000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const topmost = openDialogs.last();
    const close = topmost.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) await close.click({ timeout: 5000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1200);
}

const dialogButtonGeometry = async () =>
  page.evaluate(() => {
    const out = [];
    for (const d of document.querySelectorAll('dialog[open]')) {
      for (const el of d.querySelectorAll('button, input, select, h1, h2, h3, p, label')) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.height === 0) continue;
        out.push({
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
          text: (el.textContent ?? '').trim().slice(0, 30),
          fs: cs.fontSize,
          ff: cs.fontFamily.split(',')[0].replace(/"/g, ''),
          fw: cs.fontWeight,
          h: Math.round(r.height),
          w: Math.round(r.width),
        });
      }
    }
    return out;
  });

await nav();

// 1. Settings dialog (settings surface)
try {
  const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
  if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await settingsBtn.click({ timeout: 5000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/10-settings-dialog.png` });
    console.log('SETTINGS', JSON.stringify(await dialogButtonGeometry(), null, 1));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
} catch (e) { console.log('settings failed', e.message); }

// 2. Draw a frame then select it, open the effects/fill popover
await page.keyboard.press('Escape').catch(() => {});
try {
  const frameTool = page.getByRole('button', { name: /^frame/i }).first();
  await frameTool.click({ timeout: 5000 });
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(1150, 740, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/11-frame-selected.png` });
  const inspectorShot = page.locator('.editor-inspector').first();
  if (await inspectorShot.isVisible().catch(() => false)) {
    await inspectorShot.screenshot({ path: `${OUT}/12-inspector-frame.png` }).catch(() => {});
  }
} catch (e) { console.log('frame failed', e.message); }

// 3. Tab through inspector tabs and capture each
for (const tab of ['Adjustments', 'Prototype', 'Export']) {
  try {
    const t = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).first();
    if (await t.isVisible({ timeout: 2000 }).catch(() => false)) {
      await t.click({ timeout: 5000 });
      await page.waitForTimeout(700);
      await page.locator('.editor-inspector').first().screenshot({ path: `${OUT}/13-inspector-${tab.toLowerCase()}.png` }).catch(() => {});
    }
  } catch (e) { console.log(`${tab} failed`, e.message); }
}

// 4. Dark theme full app
try {
  await page.getByRole('tab', { name: /^design$/i }).first().click({ timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/20-dark-full.png` });
  await page.locator('.editor-inspector').first().screenshot({ path: `${OUT}/21-dark-inspector.png` }).catch(() => {});
} catch (e) { console.log('dark failed', e.message); }

// 5. Enlarged root font (the user font-size preference at "large" = 18px) and 200% browser zoom analogue (32px)
for (const [name, px] of [['large18', '18px'], ['zoom200', '32px']]) {
  try {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = p;
    }, px);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/30-rootfont-${name}.png` });
  } catch (e) { console.log(`${name} failed`, e.message); }
}
await page.evaluate(() => {
  document.documentElement.style.fontSize = '';
});

// 6. Narrow inspector rail (drawers collapse below 900px; use 1024 and 1440)
for (const w of [1024, 1280]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/40-narrow-${w}.png` });
}

await browser.close();
console.log('captured to', OUT);
