import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@wdio/globals';

async function inspectCanvas() {
  return browser.tauri.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    if (!canvas) throw new Error('Editor content canvas is absent');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas2D context is unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! < 128) continue;
      if (
        Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) -
          Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) >
        16
      )
        colored++;
    }
    return { colored, png: canvas.toDataURL('image/png') };
  });
}

async function openColorize() {
  const adjustments = await browser.$('#insp-tab-adjustments');
  if (await adjustments.isExisting()) await adjustments.click();
  else {
    await browser.$('button[aria-label^="More inspector tabs"]').click();
    await browser.$('//*[@role="menuitem" and normalize-space()="Adjustments"]').click();
  }
  const trigger = await browser.$('//button[normalize-space()="Colorize"]');
  await trigger.waitForDisplayed();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await browser.$('[role="combobox"][aria-label="Colorization workflow"]').click();
  await browser.$('//*[@role="option" and normalize-space()="Photo Colorization (AI)"]').click();
  // The quality radiogroup only exists once the photo workflow is active.
  await browser.$('[role="radiogroup"][aria-label="Quality mode"]').waitForDisplayed();
}

/** The SegmentedControl renders native radio inputs inside labelled <label>s;
 * XPath matches declared attributes, not implicit input roles. */
function qualityOption(mode: string) {
  return browser.$(
    `//div[@role="radiogroup" and @aria-label="Quality mode"]/label[.//span[normalize-space()="${mode}"]]`,
  );
}

const APPLIED_LAYER_XPATH = '//*[@role="treeitem" and contains(@aria-label,"photo-result")]';

/** Resolve the applied layer fresh. Undo removes the node, so any handle taken
 * before it goes stale — a stale element reports "not displayed" forever even
 * when redo has recreated the layer. */
function appliedLayer() {
  return browser.$(APPLIED_LAYER_XPATH);
}

/** A fresh profile shows the first-run overlay over the editor. It does not
 * trap focus, but its backdrop pollutes evidence screenshots and sits between
 * the test and the canvas; dismiss it whenever it is present. */
async function dismissFirstRunOverlay() {
  const close = await browser.$('.first-run-close[aria-label="Close"]');
  if (await close.isDisplayed().catch(() => false)) await close.click();
}

/** Genuine native models preprovisioned from the SHA-verified audit cache in an
 * isolated XDG profile. Exercises UI selection -> native CPU -> preview -> canvas
 * apply -> undo/redo; resource download and OS file picker are separate checks. */
describe('Native photo colorization applied result', () => {
  it('uses Tiny and full exactly and applies colored pixels without changing source geometry', async function () {
    // The full DDColor graph is 915 MB; its first native session open plus
    // inference took just over the previous 120s preview budget on this shared
    // machine (r6 completed with provenance moments after the deadline). Size
    // the whole journey for two cold model runs with headroom.
    this.timeout(480_000);
    const directory = process.env.VARVE_NATIVE_COLORIZE_AUDIT_DIR;
    const fixture = process.env.VARVE_NATIVE_COLORIZE_FIXTURE;
    if (!directory || !fixture)
      throw new Error('Isolated native colorization evidence paths are required');
    mkdirSync(directory, { recursive: true });
    await browser.$('[data-testid="new-file-button"]').waitForDisplayed({ timeout: 60_000 });
    await browser.$('[data-testid="new-file-button"]').click();
    await browser.$('[data-testid="create-design-button"]').waitForDisplayed();
    await browser.$('[data-testid="create-design-button"]').click();
    await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 60_000 });
    await dismissFirstRunOverlay();
    await browser.tauri.execute((_tauri, encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'native-gray-portrait.png', { type: 'image/png' }));
      const input = document.querySelector<HTMLInputElement>('#file-import-input');
      if (!input) throw new Error('Native import control is absent');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, readFileSync(fixture).toString('base64'));
    const source = await browser.$(
      '//*[@role="treeitem" and contains(@aria-label,"native-gray-portrait") and not(contains(@aria-label,"photo-result"))]',
    );
    await source.waitForDisplayed({ timeout: 30_000 });
    await source.click();
    await browser.keys(['Control', 'Shift', '4']);
    await openColorize();
    const before = await inspectCanvas();
    writeFileSync(
      join(directory, 'source-canvas.png'),
      Buffer.from(before.png.split(',')[1]!, 'base64'),
    );
    const provenances: Record<string, string> = {};
    for (const [mode, modelId] of [
      ['Fast', 'ddcolor-tiny'],
      ['Quality', 'ddcolor'],
    ] as const) {
      await source.click();
      await dismissFirstRunOverlay();
      // Undo clears the applied layer and may remount the section; re-resolve
      // the photo workflow before choosing the next explicit quality mode.
      await openColorize();
      await qualityOption(mode).click();
      const preview = await browser.$('button[aria-label="Generate colorize preview"]');
      // Preview carries a disabledReason, so it renders aria-disabled (still
      // "enabled" to WebDriverIO) while the readiness check runs, and a click
      // during that window is a legitimate no-op. Wait for the check to settle:
      // once ready, no reason is active and the title attribute disappears.
      const readinessStatus = async () =>
        browser
          .$('section[aria-label="Colorization model readiness"] p.insp-hint')
          .getText()
          .catch(() => 'readiness region absent');
      try {
        await browser.waitUntil(async () => (await preview.getAttribute('title')) === null, {
          timeout: 60_000,
          timeoutMsg: `${modelId} readiness did not settle within 60s`,
        });
      } catch (error) {
        // Preserve what the panel actually said instead of failing blind.
        await browser
          .saveScreenshot(join(directory, `${modelId}-readiness-timeout.png`))
          .catch(() => undefined);
        writeFileSync(
          join(directory, `${modelId}-readiness-timeout.json`),
          JSON.stringify({ status: await readinessStatus() }, null, 2),
        );
        throw error;
      }
      await preview.click();
      const image = await browser.$('img[alt="Colorize preview"]');
      try {
        await browser.waitUntil(
          async () => {
            const error = await browser.$('.insp-hint--error[role="alert"]');
            if (await error.isDisplayed().catch(() => false))
              throw new Error(await error.getText());
            return image.isDisplayed().catch(() => false);
          },
          { timeout: 180_000, timeoutMsg: `${modelId} returned no preview` },
        );
      } catch (error) {
        // Capture why instead of failing blind: readiness state plus whatever
        // the preview panel rendered (or did not).
        await browser
          .saveScreenshot(join(directory, `${modelId}-preview-timeout.png`))
          .catch(() => undefined);
        const previewPanel = await browser
          .$('section[aria-label="Colorize preview"]')
          .getText()
          .catch(() => 'preview panel absent');
        writeFileSync(
          join(directory, `${modelId}-preview-timeout.json`),
          JSON.stringify({ readiness: await readinessStatus(), previewPanel }, null, 2),
        );
        throw error;
      }
      const dimensions = await browser.tauri.execute(() => {
        const image = document.querySelector<HTMLImageElement>('img[alt="Colorize preview"]');
        if (!image) throw new Error('Colorize preview is absent');
        return { width: image.naturalWidth, height: image.naturalHeight, src: image.src };
      });
      expect(dimensions.width / dimensions.height).toBeCloseTo(320 / 483, 2);
      const provenance = await browser.$('[aria-label="Colorize preview provenance"]');
      await provenance.waitForDisplayed({ timeout: 10_000 });
      const provenanceText = await provenance.getText();
      // Exact-model provenance: Fast must name ddcolor-tiny, Quality ddcolor,
      // and both must name the native runtime that actually executed.
      expect(provenanceText).toContain(`native CPU (${modelId})`);
      provenances[modelId] = provenanceText;
      writeFileSync(
        join(directory, `${modelId}-preview.png`),
        Buffer.from(dimensions.src.split(',')[1]!, 'base64'),
      );
      await browser.saveScreenshot(join(directory, `${modelId}-preview-ui.png`));
      await browser.$('button[aria-label="Apply colorization at full resolution"]').click();
      await appliedLayer().waitForDisplayed({ timeout: 30_000 });
      await browser.$('button[aria-label="Fit all to viewport"]').click();
      await browser.waitUntil(async () => (await inspectCanvas()).colored > before.colored + 500, {
        timeout: 30_000,
        timeoutMsg: `${modelId} did not paint colored pixels after Apply`,
      });
      const applied = await inspectCanvas();
      writeFileSync(
        join(directory, `${modelId}-applied-canvas.png`),
        Buffer.from(applied.png.split(',')[1]!, 'base64'),
      );
      await browser.saveScreenshot(join(directory, `${modelId}-applied-ui.png`));
      await browser.keys(['Control', 'z']);
      await appliedLayer().waitForExist({ reverse: true, timeout: 30_000 });
      await browser.waitUntil(async () => (await inspectCanvas()).colored <= before.colored, {
        timeout: 30_000,
      });
      await browser.keys(['Control', 'Shift', 'z']);
      await appliedLayer().waitForDisplayed({ timeout: 30_000 });
      await browser.waitUntil(async () => (await inspectCanvas()).colored > before.colored + 500, {
        timeout: 30_000,
      });
      // Return to the unchanged source before the second explicit model run.
      await browser.keys(['Control', 'z']);
      await appliedLayer().waitForExist({ reverse: true, timeout: 30_000 });
    }
    writeFileSync(
      join(directory, 'provenances.json'),
      JSON.stringify({ provenances, sourceSize: [320, 483] }, null, 2),
    );
    expect(Object.keys(provenances)).toEqual(['ddcolor-tiny', 'ddcolor']);
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify(
        {
          sourceSize: [320, 483],
          models: ['ddcolor-tiny', 'ddcolor'],
          runtime: 'Tauri/WebKitGTK, native CPU ORT',
          canvasApply: true,
          undoRedo: true,
          acquisition: 'SHA-verified audit-cache provisioning; separate from download validation',
        },
        null,
        2,
      ),
    );
  });
});
