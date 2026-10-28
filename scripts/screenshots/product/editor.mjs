/**
 * Editor automation helpers used by the scene definitions: open a clean
 * editor, load a demo document, import an image, and reach inspector controls.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect } from '@playwright/test';
import { BASE, ROOT } from './config.mjs';
import { waitForFonts } from './settle.mjs';

/* ------------------------------------------------------------------ */
/* Editor automation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Suppresses first-run UI before any application script runs.
 *
 * The onboarding checklist, welcome dialog and "Did you know?" tips are
 * correct product behaviour for a new user and completely wrong for a
 * marketing capture — they float over the canvas and change with elapsed
 * time. Seeding the same persisted state a returning user would have is
 * deterministic and does not require the app to grow a screenshot mode.
 */
export const SEED_FIRST_RUN_STATE = () => {
  try {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        onboardingVersion: 1,
        skillLevel: 'advanced',
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
        dismissedTips: [],
        seenFeatureBadges: [],
        tutorialFileCompleted: true,
      }),
    );
    localStorage.setItem(
      'strata:tips-today',
      JSON.stringify({ count: 99, date: new Date().toDateString(), shownIds: [] }),
    );
  } catch {
    // Storage unavailable — the capture still runs, dialogs are closed below.
  }
};

/**
 * Opens a committed demo document through the application's own File > Open
 * input. The editor renders it exactly as it renders a user's document; the
 * screenshots therefore show real output, not a staged approximation.
 *
 * Readiness is the *document identity*, not a sleep. The editor exposes the
 * active session name in the shell's screen-reader heading ("<name> — Varve"),
 * so a load that failed or was rejected cannot pass as the intended document:
 * the heading would still name the previous document. A fixed sleep used to
 * sit here, which made the wrong-document capture more likely rather than less.
 */
export async function openDemoDocument(page, name) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', `${name}.varve`);
  const expectedName = basename(fixture);
  // The demo documents are committed JSON, so the exact font families they
  // need are knowable up front rather than guessed per scene.
  let requiredFonts = [];
  try {
    const doc = JSON.parse(readFileSync(fixture, 'utf8'));
    requiredFonts = [
      ...new Set(
        Object.values(doc.nodes ?? {})
          .map((node) => node?.fontFamily)
          .filter((family) => typeof family === 'string' && family.length > 0),
      ),
    ];
  } catch {
    // A fixture that does not parse is caught by the identity assertion below.
  }
  await page.setInputFiles('#file-open-input', fixture);
  try {
    await page.waitForFunction(
      (expected) => {
        const heading = document.querySelector('.editor-shell h1.sr-only');
        return !!heading && (heading.textContent ?? '').trim().startsWith(expected);
      },
      expectedName,
      { timeout: 30000 },
    );
  } catch {
    const seen = await page
      .locator('.editor-shell h1.sr-only')
      .textContent({ timeout: 2000 })
      .catch(() => null);
    throw new Error(
      `opening ${expectedName} did not change the active document heading (still "${seen ?? 'unknown'}")`,
    );
  }
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  // A document whose type would silently render in a substituted face is not a
  // faithful capture of that document.
  await waitForFonts(page, requiredFonts);
}

/**
 * Imports a real photo fixture through the application's own image-import
 * input — the same `#file-import-input` the e2e suite uses (see
 * tests/e2e/helpers/editor-helpers.ts). Scenes that demonstrate image-based
 * tools (palette extraction, enhance) need genuine photographic content;
 * see fixtures/PROVENANCE.md for the source and license of every photo here.
 */
export async function importImage(page, fileName) {
  const fixture = join(ROOT, 'scripts', 'screenshots', 'fixtures', fileName);
  await page.setInputFiles('#file-import-input', fixture);
  await page.getByRole('treeitem').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  // A real (larger, decoded) photo can surface a dialog that a tiny
  // synthetic fixture never does (e.g. a stray onboarding/tips prompt that
  // reflows once real content lands). Clear it defensively — the same
  // stacked-dialog loop openCleanEditor already runs at startup — so it
  // can't intercept the next click.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (!(await close.isVisible({ timeout: 400 }).catch(() => false))) break;
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

/** Selects the (single, just-imported) image node so tool panels act on it. */
export async function selectImageNode(page) {
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  await page.getByRole('treeitem').first().click();
  await page.waitForTimeout(200);
}

/**
 * Deterministic framing: identical zoom/pan for every capture of a document.
 *
 * "Fit all" (content bounds) rather than "Fit page": the demo documents are
 * flat documents whose artwork is a frame, so fitting the default page size
 * zooms past the artwork and crops it.
 */
export async function fitContent(page) {
  // The status-bar control carries the accessible name "Fit all to viewport";
  // its visible label is "Fit all". Selecting a layer reveals (and zooms to)
  // it, so callers must fit *after* selecting, never before.
  const fit = page.getByRole('button', { name: /fit all to viewport/i }).first();
  await fit.waitFor({ state: 'visible', timeout: 8000 });
  await fit.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  const zoom = await currentZoom(page);
  if (zoom === null) throw new Error('could not read the zoom level to verify framing');
  if (zoom > 110) {
    throw new Error(`fit-all did not frame the document (zoom stayed at ${zoom}%)`);
  }
}

/** Reads the status-bar zoom percentage, used to assert deterministic framing. */
export async function currentZoom(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.editor-status__zoom-value');
    return el instanceof HTMLInputElement ? Number(el.value) : null;
  });
}

/** Selects a named layer so the inspector shows real properties, not "No selection". */
export async function selectLayer(page, pattern) {
  const panel = page.locator('#editor-layers-panel');
  let openedDrawer = false;
  let item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
  if (!(await item.isVisible({ timeout: 500 }).catch(() => false))) {
    const showLayers = page.getByRole('button', { name: 'Show layers panel' });
    if (await showLayers.isVisible({ timeout: 1000 }).catch(() => false)) {
      await showLayers.click();
      await panel.waitFor({ state: 'visible', timeout: 5000 });
      openedDrawer = true;
      item = page.getByRole('treeitem').filter({ hasText: pattern }).first();
    }
  }
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  if (openedDrawer) {
    await page.getByRole('button', { name: /Collapse Layers panel/ }).click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
  }
}

/** Select the Page tool whether it is in the visible toolbar or its Layout overflow. */
export async function activatePageTool(page) {
  const toolbar = page.getByTestId('toolbar');
  const pageTool = toolbar.locator('[data-tool="page"]');
  if (await pageTool.isVisible().catch(() => false)) {
    await pageTool.click();
  } else {
    // Print intentionally keeps the Page tool out of its toolbar.
    await page.keyboard.press('q');
  }
  // The overlay wrapper contains only absolutely-positioned children and has
  // zero intrinsic size, so Playwright correctly considers the wrapper hidden.
  // Assert the actual trim outline instead: it is visible only with the Page
  // tool active and an active page selected.
  await expect(page.locator('.page-tool-overlay > div').first()).toBeVisible();
}

export async function openCleanEditor(page, { print = false } = {}) {
  await page.goto(`${BASE}/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  // Crash recovery dialog / safe-mode leftovers must not leak into shots.
  const inSafeMode = await page.evaluate(() => localStorage.getItem(`varve:safe-mode`) !== null);
  if (inSafeMode) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover your documents/i,
  });
  if ((await recovery.count()) > 0) {
    await recovery
      .getByRole('button', { name: /review my documents/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 120000 });
  await newBtn.click({ force: true, timeout: 15000 });
  if (print) {
    await page
      .locator('dialog[open]')
      .getByText('Advanced settings', { exact: false })
      .first()
      .click({ force: true })
      .catch(() => undefined);
    await page
      .locator('dialog[open]')
      .getByRole('radio', { name: /print/i })
      .first()
      .click({ force: true })
      .catch(() => undefined);
  }
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /create design/i })
    .or(page.locator('dialog[open]').getByRole('button', { name: /create/i }))
    .first()
    .click({ timeout: 30000 });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('.editor-canvas').waitFor({ state: 'visible', timeout: 30000 });
  // The shell becomes visible before its interaction surfaces finish their
  // first render. A draw issued in that gap can silently leave an empty
  // document, so hand a scene control only after the real canvas and layer
  // tree are mounted at non-zero size (the same readiness contract as E2E).
  const contentCanvas = page.locator('canvas.editor-canvas__content-layer');
  await contentCanvas.waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('.layers-panel').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas.editor-canvas__content-layer');
      return (
        canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 && canvas.clientHeight > 0
      );
    },
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(250);
  // Close stacked startup dialogs deterministically.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    if ((await openDialogs.count()) === 0) break;
    const close = openDialogs.last().getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => undefined);
    }
  }
  const exitFocus = page.getByRole('button', { name: /exit distraction-free mode/i });
  if (await exitFocus.isVisible().catch(() => false)) {
    await exitFocus.click({ timeout: 5000 });
    await page.locator('.editor-shell:not(.editor-shell--distraction-free)').waitFor({
      state: 'visible',
      timeout: 8000,
    });
  }
}

/** Opens the image-tools ("Adjustments") tab for a selected image node. */
export async function openImageToolsTab(page) {
  const tab = page.getByRole('tab', { name: /^Adjustments/i });
  if (!(await tab.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('image tools tab unavailable for the selected image');
  }
  await tab.click();
  await page.locator('.insp-disclosure').first().waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * Expands one inspector disclosure and scrolls it to the top of the panel.
 * These sections collapse by default and sit below a long stack, so a capture
 * without this lands on whatever happens to be in the crop instead.
 */
export async function expandSection(page, titleRe) {
  const section = page.locator('.insp-disclosure').filter({ hasText: titleRe });
  if (!(await section.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error(`inspector section ${titleRe} not present`);
  }
  const trigger = section.getByRole('button', { name: titleRe }).first();
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
    await page.waitForTimeout(500);
  }
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  return section;
}

/** Wait for an inference result while preserving a visible model error. */
export async function waitForInferenceResult(success, section, timeout) {
  const error = section.getByRole('alert').first();
  try {
    return await Promise.race([
      success.waitFor({ state: 'visible', timeout }).then(() => 'success'),
      error
        .waitFor({ state: 'visible', timeout })
        .then(async () => ({ error: (await error.textContent().catch(() => ''))?.trim() })),
    ]);
  } catch {
    return 'timeout';
  }
}
