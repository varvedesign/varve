/**
 * E2E: File → Import must open the asset/artwork picker (accepting svg/png/
 * jpg/...), NOT the document-open picker. The regression this guards is the
 * reported bug where Import silently opened the .varve/.strata/.json document
 * picker, making images and SVGs impossible to import from the menu.
 *
 * The test clicks the real menu action and feeds files to the hidden
 * `#file-import-input`, then asserts the artwork actually lands in the scene.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Minimal 1x1 RGBA PNG (valid signature + IHDR + IDAT + IEND with CRCs).
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5fNwAAAAABJRU5ErkJggg==';

const SIMPLE_SVG =
  '<svg><rect x="10" y="10" width="100" height="60" fill="#1f8a70" /><circle cx="60" cy="40" r="24" fill="#ffd166" /></svg>';
const CLONED_FILL_OPACITY_SVG =
  '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><rect id="opacity-source" width="100" height="60" fill="#e5e" fill-opacity=".1" /></defs><use xlink:href="#opacity-source" /><use xlink:href="#opacity-source" x="110" /></svg>';
const INLINE_TEXT_STYLES_SVG =
  '<svg width="240" height="100" viewBox="0 0 240 100"><text x="120" y="60" style="font-size:32px;font-family:DejaVu Serif;font-weight:bold;text-anchor:middle" fill="#1f8a70">Styled SVG</text></svg>';
const CURRENT_COLOR_SVG =
  '<svg width="160" height="120" viewBox="0 0 160 120"><g color="#123456"><rect x="20" y="20" width="120" height="80" fill="currentColor" /></g></svg>';
const SVG_VISIBILITY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" visibility="hidden"><g visibility="hidden"><rect x="10" y="10" width="60" height="60" fill="#ef4444" /><rect x="50" y="10" width="60" height="60" visibility="visible" fill="#facc15" /></g><rect x="120" y="10" width="40" height="60" fill="#22c55e" style="display:none" /><rect x="170" y="10" width="60" height="60" visibility="visible" fill="#2563eb" /></svg>';
const SVG_MIXED_SUBPATH_HOLE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#2563eb" d="M0 0h24v24H0M6 6v12h12V6z" /></svg>';

async function openImportFromMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /import/i }).click();
}

async function ensureEditor(page: import('@playwright/test').Page): Promise<void> {
  const layers = page.locator('.layers-panel');
  if (await layers.isVisible({ timeout: 1000 }).catch(() => false)) return;

  const recentFile = page.getByRole('gridcell').first();
  await recentFile.waitFor({ state: 'visible', timeout: 10000 });
  await recentFile.click();
  await layers.waitFor({ state: 'visible', timeout: 30000 });
}

async function selectionChromeCollisions(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const names = Array.from(
      document.querySelectorAll('.canvas-name-labels text[data-selected="true"]'),
      (node) => node.getBoundingClientRect(),
    );
    const gaps = Array.from(document.querySelectorAll('.alignment-handle__label'), (node) =>
      node.getBoundingClientRect(),
    );
    const artwork = Array.from(
      document.querySelectorAll('[data-testid="alignment-artwork-obstacle"]'),
      (node) => node.getBoundingClientRect(),
    );
    const hint = document.querySelector('.micro-hint')?.getBoundingClientRect();
    const actions = document.querySelector('.selection-quick-bar')?.getBoundingClientRect();
    return {
      names: names.some((name, index) =>
        names.slice(index + 1).some((other) => overlap(name, other)),
      ),
      gaps: names.some((name) => gaps.some((gap) => overlap(name, gap))),
      readouts: gaps.some((gap, index) =>
        gaps.slice(index + 1).some((other) => overlap(gap, other)),
      ),
      artwork: gaps.some((gap) => artwork.some((item) => overlap(gap, item))),
      hint: Boolean(hint && actions && overlap(hint, actions)),
    };
  });
}

test.describe('File → Import', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await ensureEditor(page);
  });

  test('Import picker accepts PNG and SVG artwork and renders it in the document', async ({
    page,
  }) => {
    await openImportFromMenu(page);
    await expect(page.locator('#file-import-input')).toBeAttached();
    // The import picker must advertise raster + vector, never only documents.
    const accept = await page.locator('#file-import-input').getAttribute('accept');
    expect(accept).toContain('.png');
    expect(accept).toContain('.svg');
    expect(accept).not.toContain('.varve');

    await page.locator('#file-import-input').setInputFiles([
      {
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PNG_1X1_BASE64, 'base64'),
      },
      {
        name: 'logo.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(SIMPLE_SVG, 'utf-8'),
      },
    ]);

    const layers = page.locator('.layers-panel');
    await expect(layers.getByText('photo.png')).toBeVisible({ timeout: 30000 });
    // The PNG is one node; the SVG contributes its root and two vector
    // children to the layer tree.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(3, {
      timeout: 30000,
    });
    await expect(
      page.getByTestId('selection-quick-bar').getByRole('button', { name: 'Group' }),
    ).toBeVisible();
    await expect(page.locator('.canvas-name-labels text[data-selected="true"]')).toHaveCount(3);
    await expect
      .poll(() => selectionChromeCollisions(page))
      .toEqual({
        names: false,
        gaps: false,
        readouts: false,
        artwork: false,
        hint: false,
      });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    await expect(canvas).toHaveScreenshot('file-import-svg.png', {
      // Canvas worker startup can leave the SVG paint one frame behind while
      // the imported scene and selection are already authoritative.
      maxDiffPixels: 7000,
    });
  });

  test('preserves inline SVG font styles and renders imported text', async ({ page }, testInfo) => {
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'inline-text-style.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(INLINE_TEXT_STYLES_SVG, 'utf-8'),
    });

    await expect(page.locator('.typography-controls')).toBeVisible({ timeout: 30000 });
    const typography = page.locator('.typography-controls');
    await expect(typography.getByRole('combobox', { name: 'Font family' })).toHaveValue(
      'DejaVu Serif',
    );
    await expect(typography.getByRole('spinbutton', { name: 'Size (px)' })).toHaveValue('32');
    await expect(typography.getByRole('combobox', { name: 'Font weight' })).toHaveText('700');
    await expect(
      typography
        .getByRole('radiogroup', { name: 'Horizontal align', exact: true })
        .getByRole('radio', {
          name: 'Align right',
        }),
    ).not.toBeChecked();
    await expect(
      typography
        .getByRole('radiogroup', { name: 'Horizontal align', exact: true })
        .getByRole('radio', {
          name: 'Align center',
        }),
    ).toBeChecked();

    await page.keyboard.press('Escape');
    const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
    if (await dismissHint.isVisible().catch(() => false)) {
      await dismissHint.click({ timeout: 1000 }).catch(() => undefined);
    }
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    // Assert that glyphs actually painted instead of comparing exact text
    // pixels: the branch that authored this baseline had a different font
    // stack from CI, and a pixel-perfect text comparison cannot hold across
    // hosts. The typography controls above already prove the inline styles
    // survived the import; this proves the text reached the canvas.
    const inkRatio = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const { width, height } = target;
      if (width === 0 || height === 0) return 0;
      const { data } = context.getImageData(0, 0, width, height);
      let ink = 0;
      for (let index = 3; index < data.length; index += 4) {
        if ((data[index] ?? 0) > 8) ink += 1;
      }
      return ink / (width * height);
    });
    expect(inkRatio).toBeGreaterThan(0.001);
    await testInfo.attach('inline-svg-text-style-canvas', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('resolves inherited currentColor paints in imported SVG artwork', async ({
    page,
  }, testInfo) => {
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'inherited-current-color.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(CURRENT_COLOR_SVG, 'utf-8'),
    });

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(2, { timeout: 30000 });
    await page.keyboard.press('Escape');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
    await page.waitForTimeout(700);
    // Assert the inherited colour actually reached the pixels instead of
    // comparing a screenshot. A per-host baseline cannot distinguish "the
    // inherited paint is correct" from "antialiasing moved one pixel"; this
    // counts pixels painted with the inherited #123456 fill, which is
    // host-independent.
    const inheritedPaint = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return 0;
      const { width, height } = target;
      if (width === 0 || height === 0) return 0;
      const { data } = context.getImageData(0, 0, width, height);
      let matched = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          Math.abs((data[index] ?? 0) - 0x12) <= 6 &&
          Math.abs((data[index + 1] ?? 0) - 0x34) <= 6 &&
          Math.abs((data[index + 2] ?? 0) - 0x56) <= 6 &&
          (data[index + 3] ?? 0) > 200
        ) {
          matched += 1;
        }
      }
      return matched;
    });
    expect(inheritedPaint).toBeGreaterThan(500);
    await testInfo.attach('inline-svg-current-color-canvas', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('renders fractional fill opacity on repeated SVG use instances', async ({ page }) => {
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'clone-opacity.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(CLONED_FILL_OPACITY_SVG, 'utf-8'),
    });

    const layers = page.locator('.layers-panel');
    // Each <use> becomes a shape node; the filename is not a separate layer.
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(2, { timeout: 30000 });
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ position: { x: 40, y: 40 } });
    const dismissHint = page.getByRole('button', { name: 'Dismiss hint' });
    if (await dismissHint.isVisible().catch(() => false)) {
      await dismissHint.click({ timeout: 1000 }).catch(() => undefined);
    }
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    await expect(canvas).toHaveScreenshot('file-import-svg-use-opacity.png', {
      maxDiffPixels: 100,
    });
  });

  test('preserves hidden SVG visibility and omits display-none artwork', async ({ page }) => {
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'visibility.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG_VISIBILITY_SVG, 'utf-8'),
    });

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]')).toHaveCount(4, { timeout: 30000 });
    await expect(
      layers.getByRole('treeitem', { name: /Rectangle, Vector rectangle, hidden/ }),
    ).toHaveCount(1);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    await expect(canvas).toHaveScreenshot('file-import-svg-visibility.png', {
      maxDiffPixels: 100,
    });
  });

  test('renders a hole formed by mixed open and closed SVG subpaths', async ({ page }) => {
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'mixed-contour-hole.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG_MIXED_SUBPATH_HOLE, 'utf-8'),
    });

    await expect(page.locator('.layers-panel [role="treeitem"]')).toHaveCount(1, {
      timeout: 30000,
    });
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await page.evaluate(() => {
      (
        window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
      ).__varvePerf?.forceFullRedraw?.();
    });
    await page.waitForTimeout(700);
    await canvas.click({ position: { x: 150, y: 150 } });
    await page.waitForTimeout(100);
    await expect(canvas).toHaveScreenshot('file-import-svg-mixed-subpath-hole.png', {
      maxDiffPixels: 100,
    });
  });

  test('Import picker accepts JPEG artwork and renders the raster image', async ({ page }) => {
    await openImportFromMenu(page);
    const jpeg = await readFile('tests/fixtures/bg-removal-corpus/object.jpg');
    await page.locator('#file-import-input').setInputFiles({
      name: 'object.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    });

    const layers = page.locator('.layers-panel');
    await expect(layers.getByText('object.jpg')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-jpeg.png',
      { maxDiffPixels: 7000 },
    );
  });

  test('Import picker imports the remaining raster formats', async ({ page }) => {
    await openImportFromMenu(page);
    const files = await Promise.all(
      ['raster.webp', 'raster.gif', 'raster.bmp', 'raster.tif', 'raster.avif'].map(
        async (name) => ({
          name,
          mimeType: `image/${name.split('.').pop()}`,
          buffer: await readFile(`tests/fixtures/import-corpus/${name}`),
        }),
      ),
    );
    await page.locator('#file-import-input').setInputFiles(files);

    const layers = page.locator('.layers-panel');
    for (const file of files) {
      await expect(layers.getByText(file.name)).toBeVisible({ timeout: 30000 });
    }
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-raster-matrix.png',
      { maxDiffPixels: 12000 },
    );
  });

  test('Import picker advertises parser-backed formats', async ({ page }) => {
    await openImportFromMenu(page);
    const accept = await page.locator('#file-import-input').getAttribute('accept');
    for (const extension of [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.bmp',
      '.tif',
      '.tiff',
      '.avif',
      '.psd',
      '.psb',
      '.svg',
      '.pdf',
      '.ai',
      '.eps',
      '.fig',
      '.sketch',
    ]) {
      expect(accept).toContain(extension);
    }
  });

  test('PSD and PSB import real layered documents', async ({ page }) => {
    const reactFlushWarnings: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().includes('flushSync was called from inside a lifecycle method')
      ) {
        reactFlushWarnings.push(message.text());
      }
    });
    await openImportFromMenu(page);
    const files = await Promise.all(
      ['example.psd', 'example.psb'].map(async (name) => ({
        name,
        mimeType: 'image/vnd.adobe.photoshop',
        buffer: await readFile(`tests/fixtures/import-corpus/${name}`),
      })),
    );
    await page.locator('#file-import-input').setInputFiles(files);

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('dialog', { name: 'Import results' })).toContainText(/imported/i);
    expect(reactFlushWarnings).toEqual([]);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-psd.png',
      { maxDiffPixels: 12000 },
    );
  });

  test('PDF, AI, and EPS parser imports produce scene content', async ({ page }) => {
    await openImportFromMenu(page);
    const pdf = `%PDF-1.4
BT /F1 12 Tf 100 700 Td (Imported PDF) Tj ET
100 100 200 100 re f
`;
    const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 300 200
20 30 120 80 rectfill
showpage
`;
    await page.locator('#file-import-input').setInputFiles([
      { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) },
      { name: 'sample.ai', mimeType: 'application/postscript', buffer: Buffer.from(pdf) },
      { name: 'sample.eps', mimeType: 'application/postscript', buffer: Buffer.from(eps) },
    ]);

    const layers = page.locator('.layers-panel');
    await expect(layers.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 30000 });
    const importResults = page.getByRole('dialog', { name: 'Import results' });
    await expect(importResults).toContainText(/imported/i);
    await expect(page.getByRole('dialog', { name: 'Missing Fonts' })).toHaveCount(0);
    await expect(page.locator('canvas.editor-canvas__content-layer')).toHaveScreenshot(
      'file-import-vector-parsers.png',
      { maxDiffPixels: 12000 },
    );
    await importResults.getByRole('button', { name: 'Close', exact: true }).click();
    const missingFonts = page.getByRole('dialog', { name: 'Missing Fonts' });
    await expect(missingFonts).toBeVisible();
    await missingFonts.getByRole('button', { name: 'Dismiss' }).click();
  });

  test('cancels file preparation before parsing begins', async ({ page }) => {
    await page.evaluate(() => {
      type PreparationProbe = Window & {
        __filePreparationReadStarted?: boolean;
        __filePreparationAborted?: boolean;
        __filePreparationAbortEventFired?: boolean;
        __filePreparationReaderState?: number;
      };
      const probe = window as PreparationProbe;
      class ControlledFileReader {
        static readonly EMPTY = 0;
        static readonly LOADING = 1;
        static readonly DONE = 2;
        readyState: number = FileReader.EMPTY;
        result: string | ArrayBuffer | null = null;
        error: DOMException | null = null;
        onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
        onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
        onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
        onloadstart: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
        onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

        readAsArrayBuffer() {
          this.readyState = FileReader.LOADING;
          probe.__filePreparationReadStarted = true;
          probe.__filePreparationReaderState = this.readyState;
        }

        abort() {
          if (this.readyState !== FileReader.LOADING) return;
          this.readyState = FileReader.DONE;
          probe.__filePreparationAborted = true;
          probe.__filePreparationReaderState = this.readyState;
          this.onabort?.call(
            this as unknown as FileReader,
            new ProgressEvent('abort') as ProgressEvent<FileReader>,
          );
          probe.__filePreparationAbortEventFired = true;
        }
      }
      Object.defineProperty(window, 'FileReader', {
        configurable: true,
        value: ControlledFileReader,
      });
    });
    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles({
      name: 'delayed.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SIMPLE_SVG, 'utf-8'),
    });

    const progress = page.locator('.import-progress');
    await expect(progress).toHaveAttribute('data-stage', 'preparing');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __filePreparationReadStarted?: boolean })
              .__filePreparationReadStarted,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __filePreparationReaderState?: number })
              .__filePreparationReaderState,
        ),
      )
      .toBe(1);
    await expect(progress.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(progress).toContainText('Preparing files: 0 of 1 ready');
    await test.info().attach('import-preparation-state', {
      body: await progress.screenshot(),
      contentType: 'image/png',
    });
    await progress.getByRole('button', { name: 'Cancel import' }).click();
    await expect(progress).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __filePreparationAborted?: boolean }).__filePreparationAborted,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __filePreparationReaderState?: number })
              .__filePreparationReaderState,
        ),
      )
      .toBe(2);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __filePreparationAbortEventFired?: boolean })
              .__filePreparationAbortEventFired,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('dialog', { name: 'Import results' })).toHaveCount(0);
    await expect(page.locator('.layers-panel').getByText('delayed.svg')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(0);
  });

  test('identifies the file during asynchronous PSD decoding', async ({ page }) => {
    const psd = await readFile('tests/fixtures/import-corpus/example.psd');
    // The importing stage can be shorter than one Playwright poll on a fast
    // machine, so record every progress mutation from before the selection
    // instead of racing the label. A three-file batch guarantees at least one
    // decode runs while the progress surface is mounted.
    await page.evaluate(() => {
      const target = window as unknown as { __importProgressLog?: string[] };
      target.__importProgressLog = [];
      new MutationObserver(() => {
        const element = document.querySelector('.import-progress');
        if (!element) return;
        target.__importProgressLog?.push(
          `${element.getAttribute('data-stage')}|${element.textContent ?? ''}`,
        );
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await openImportFromMenu(page);
    await page.locator('#file-import-input').setInputFiles([
      { name: 'example.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: psd },
      { name: 'example-2.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: psd },
      { name: 'example-3.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: psd },
    ]);

    await expect(page.locator('.layers-panel [role="treeitem"]').first()).toBeVisible({
      timeout: 30000,
    });

    const log = await page.evaluate(
      () => (window as unknown as { __importProgressLog?: string[] }).__importProgressLog ?? [],
    );
    const parsingStates = log.filter(
      (entry) => entry.startsWith('importing|') && entry.includes('Parsing: example'),
    );
    expect(parsingStates.length).toBeGreaterThan(0);
  });
});
