import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@wdio/globals';

/** Opt-in real acquisition -> worker -> Tauri -> ORT -> editable text journey.
 * Run with a fresh XDG profile under heavy-lease and VARVE_NATIVE_OCR_AUDIT_DIR.
 * The fixture enters through the native webview's DOM file-import handler;
 * this does not exercise the operating-system file picker. Native provenance
 * is asserted from the panel's own execution-provider disclosure. */
describe('Native OCR applied result', () => {
  it('downloads the real resources, recognizes pixels and creates undoable editable text', async function () {
    this.timeout(300_000);
    const directory = process.env.VARVE_NATIVE_OCR_AUDIT_DIR;
    const fixture = process.env.VARVE_NATIVE_OCR_FIXTURE;
    if (!directory || !fixture) throw new Error('Isolated native OCR evidence paths are required');
    mkdirSync(directory, { recursive: true });

    await browser.$('[data-testid="new-file-button"]').waitForDisplayed({ timeout: 60_000 });

    await browser.$('[data-testid="new-file-button"]').click();
    await browser.$('[data-testid="create-design-button"]').waitForDisplayed();
    await browser.$('[data-testid="create-design-button"]').click();
    await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 60_000 });
    await browser.tauri.execute((_tauri, encoded: string) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'ocr-printed-line.png', { type: 'image/png' }));
      const input = document.querySelector<HTMLInputElement>('#file-import-input');
      if (!input) throw new Error('Native import control is absent');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, readFileSync(fixture).toString('base64'));

    const imageLayer = await browser.$(
      '//*[@role="treeitem" and contains(@aria-label,"ocr-printed-line")]',
    );
    await imageLayer.waitForDisplayed({ timeout: 30_000 });
    await imageLayer.click();
    await browser.keys(['Control', 'Shift', '4']);
    const adjustments = await browser.$('#insp-tab-adjustments');
    if (await adjustments.isExisting()) {
      await adjustments.click();
    } else {
      await browser.$('button[aria-label^="More inspector tabs"]').click();
      await browser.$('//*[@role="menuitem" and normalize-space()="Adjustments"]').click();
    }
    const disclosure = await browser.$('//button[normalize-space()="Recognize Text"]');
    await disclosure.waitForDisplayed();
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const download = await browser.$('button[aria-label="Download OCR models (~15 MB)"]');
    await download.waitForDisplayed();
    await browser.saveScreenshot(join(directory, '01-acquire.png'));
    await download.click();

    const recognize = await browser.$('button[aria-label="Recognize text in image"]');
    await browser.waitUntil(
      async () => {
        const error = await browser.$('.insp-hint--error[role="alert"]');
        if (await error.isDisplayed().catch(() => false)) throw new Error(await error.getText());
        return recognize.isDisplayed().catch(() => false);
      },
      { timeout: 120_000, timeoutMsg: 'Real native OCR acquisition did not finish' },
    );
    await recognize.click();
    const result = await browser.$('.ocr-results input');
    await browser.waitUntil(
      async () => {
        const error = await browser.$('.insp-hint--error[role="alert"]');
        if (await error.isDisplayed().catch(() => false)) throw new Error(await error.getText());
        return result.isDisplayed().catch(() => false);
      },
      { timeout: 90_000, timeoutMsg: 'Real native OCR returned no editable recognition' },
    );
    expect(await result.getValue()).toBe('Hello world 2026');
    await browser.saveScreenshot(join(directory, '02-recognized.png'));

    // The panel discloses the provider that actually executed recognition; a
    // browser/WASM run would say WebAssembly and must not pass as native.
    const provenance = await browser.$('[aria-label="OCR recognition provenance"]');
    await provenance.waitForDisplayed();
    const provenanceText = await provenance.getText();
    writeFileSync(
      join(directory, 'provenance.json'),
      JSON.stringify(
        {
          recognition: 'Hello world 2026',
          recognitionModelId: 'paddleocr-rec-v4',
          panelProvenance: provenanceText,
          resources: [
            'data/dev.varve.desktop.wdio/models/paddleocr-det-v4.onnx',
            'data/dev.varve.desktop.wdio/models/paddleocr-rec-v4.onnx',
            'data/dev.varve.desktop.wdio/models/paddleocr-keys-v1.txt',
          ],
        },
        null,
        2,
      ),
    );
    expect(provenanceText).toContain('paddleocr-rec-v4');
    expect(provenanceText).toContain('ran on native CPU');

    await browser.$('button[aria-label="Create editable text layers"]').click();
    const textLayerSelector =
      '//*[@role="treeitem" and contains(@aria-label,"OCR: Hello world 2026")]';
    await browser.$(textLayerSelector).waitForDisplayed();
    await browser.saveScreenshot(join(directory, '03-applied.png'));
    await browser.keys(['Control', 'z']);
    await browser.$(textLayerSelector).waitForExist({ reverse: true });
    await browser.keys(['Control', 'Shift', 'z']);
    await browser.$(textLayerSelector).waitForDisplayed();
    await browser.$(textLayerSelector).click();
    await browser.$('//*[@role="tab" and normalize-space()="Design"]').click();
    const typography = await browser.$('//button[normalize-space()="Typography"]');
    await typography.waitForDisplayed();
    if ((await typography.getAttribute('aria-expanded')) !== 'true') await typography.click();
    const text = await browser.$('[aria-label="Text content"]');
    await text.waitForDisplayed();
    expect(await text.getValue()).toBe('Hello world 2026');
    await text.setValue('Hello edited 2026');
    await browser.keys('Tab');
    expect(await text.getValue()).toBe('Hello edited 2026');
    await browser.saveScreenshot(join(directory, '04-editable.png'));
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify(
        {
          recognized: 'Hello world 2026',
          edited: 'Hello edited 2026',
          runtime: 'Tauri/WebKitGTK with native CPU ORT',
          undoRedo: true,
          input: 'DOM file import; not OS picker',
        },
        null,
        2,
      ),
    );
  });
});
