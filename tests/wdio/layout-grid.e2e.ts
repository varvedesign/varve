/// <reference types="@wdio/globals/types" />

import { mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { expect } from '@wdio/globals';
import type {} from '@wdio/tauri-service';

declare function describe(name: string, suite: () => void): void;
declare function it(
  name: string,
  test: (this: { timeout: (milliseconds: number) => void }) => Promise<void>,
): void;

/** Native Tauri layout interaction and rendered-geometry evidence. */
describe('Tauri layout grid workflow', () => {
  it('authors a two-column dashboard grid and captures its resolved cards', async function () {
    const screenshotPath = process.env.VARVE_LAYOUT_NATIVE_SCREENSHOT;
    if (!screenshotPath) throw new Error('VARVE_LAYOUT_NATIVE_SCREENSHOT is required');
    this.timeout(120_000);
    mkdirSync(dirname(screenshotPath), { recursive: true });

    const continueStartup = await browser.$('button=Continue normal startup');
    if (await continueStartup.isDisplayed().catch(() => false)) {
      await continueStartup.click();
      await browser.$('.safe-mode-screen').waitForDisplayed({ reverse: true, timeout: 30_000 });
    }

    const newButton = await browser.$('[data-testid="new-file-button"]');
    await newButton.waitForDisplayed({ timeout: 30_000 });
    await newButton.click();
    const createButton = await browser.$('[data-testid="create-design-button"]');
    await createButton.waitForDisplayed({ timeout: 10_000 });
    await createButton.click();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await canvas.waitForDisplayed({ timeout: 30_000 });
    const firstRunClose = await browser.$('.first-run-close');
    if (await firstRunClose.isDisplayed().catch(() => false)) {
      await firstRunClose.click();
      await browser.$('.first-run-content').waitForDisplayed({ reverse: true, timeout: 10_000 });
    }
    if (await (await browser.$('button=Discard All')).isDisplayed().catch(() => false)) {
      throw new Error('native layout test requires a fresh isolated XDG profile');
    }

    await browser.tauri.execute(() => {
      const surface = document.querySelector('[data-testid="editor-canvas"]');
      if (!(surface instanceof HTMLCanvasElement)) throw new Error('editor canvas not found');
      const { width, height } = surface.getBoundingClientRect();
      if (width < 240 || height < 200)
        throw new Error('native canvas is too small for layout case');
    });

    async function draw(toolId: 'frame' | 'rect', start: [number, number], end: [number, number]) {
      const tool = await browser.$(`[data-tool="${toolId}"]`);
      await tool.waitForDisplayed({ timeout: 10_000 });
      await tool.click();
      await browser.execute(
        (startX, startY, endX, endY) => {
          const surface = document.querySelector('[data-testid="editor-canvas"]');
          if (!(surface instanceof HTMLCanvasElement)) throw new Error('editor canvas not found');
          const { x, y, width, height } = surface.getBoundingClientRect();
          const from = [x + width * startX, y + height * startY];
          const to = [x + width * endX, y + height * endY];
          const emit = (type: string, [clientX, clientY]: number[], buttons: number) =>
            surface.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                pointerId: 31,
                pointerType: 'mouse',
                isPrimary: true,
                buttons,
              }),
            );
          emit('pointerdown', from, 1);
          emit('pointermove', to, 1);
          emit('pointerup', to, 0);
        },
        start[0],
        start[1],
        end[0],
        end[1],
      );
      await browser.pause(350);
    }

    await draw('frame', [0.12, 0.12], [0.82, 0.78]);
    await draw('rect', [0.2, 0.2], [0.37, 0.38]);
    await draw('rect', [0.5, 0.2], [0.67, 0.38]);

    const frameLayer = await browser.$('[role="treeitem"][data-layer-type="frame"]');
    await frameLayer.waitForDisplayed({ timeout: 10_000 });
    await frameLayer.click();
    const mode = await browser.$('[role="combobox"][aria-label="Layout mode"]');
    await mode.waitForDisplayed({ timeout: 10_000 });
    await mode.click();
    await (await browser.$('//*[@role="option" and normalize-space(.)="Grid"]')).click();

    const columns = await browser.$('input[aria-label="Grid template columns"]');
    await columns.waitForDisplayed({ timeout: 10_000 });
    await columns.setValue('1fr 1fr');
    await columns.click();
    await browser.keys(['Tab']);
    expect(await columns.getValue()).toBe('1fr 1fr');

    const readSelectedCard = async (name: string) => {
      const row = await browser.$(`[role="treeitem"][aria-label*="${name}"]`);
      await row.waitForDisplayed({ timeout: 10_000 });
      await row.click();
      await browser.waitUntil(async () => (await row.getAttribute('aria-selected')) === 'true', {
        timeout: 5_000,
        timeoutMsg: `${name} did not become the selected layout child`,
      });
      return browser.tauri.execute(() => {
        const outline = document.querySelector<SVGGraphicsElement>(
          'svg:has(filter#selection-glow) > rect',
        );
        if (!outline) throw new Error('selected-card geometry outline is missing');
        const { x, y, width, height } = outline.getBoundingClientRect();
        return { x, y, width, height };
      });
    };

    expect(
      await browser
        .$('.first-run-content')
        .isDisplayed()
        .catch(() => false),
    ).toBe(false);
    const screenshotBase = basename(screenshotPath, extname(screenshotPath));
    for (const [width, height] of [
      [900, 600],
      [1280, 800],
      [1600, 1000],
    ] as const) {
      await browser.setWindowSize(width, height);
      await browser.pause(500);
      const first = await readSelectedCard('Rectangle 1');
      const second = await readSelectedCard('Rectangle 2');
      if (width === 900) {
        await browser.execute(() => {
          const panel = document.querySelector<HTMLElement>('.editor-inspector > .insp-panel');
          const heading = document.querySelector<HTMLElement>('.insp-grid-placement__title');
          if (!panel || !heading) throw new Error('grid placement section is missing');
          panel.scrollTop +=
            heading.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        });
        const placementVisible = await browser.execute(() => {
          const panel = document.querySelector<HTMLElement>('.editor-inspector > .insp-panel');
          const heading = document.querySelector<HTMLElement>('.insp-grid-placement__title');
          if (!panel || !heading) return false;
          const panelRect = panel.getBoundingClientRect();
          const headingRect = heading.getBoundingClientRect();
          return headingRect.top >= panelRect.top && headingRect.bottom <= panelRect.bottom;
        });
        expect(placementVisible).toBe(true);
        await browser.execute(() => {
          const panel = document.querySelector<HTMLElement>('.editor-inspector > .insp-panel');
          if (panel) panel.scrollTop = 0;
        });
      }
      expect(Math.abs(first.width - second.width)).toBeLessThan(2);
      expect(second.x).toBeGreaterThan(first.x + first.width + 4);
      expect(Math.abs(first.y - second.y)).toBeLessThan(2);
      await browser.saveScreenshot(
        join(dirname(screenshotPath), `${screenshotBase}-${width}x${height}.png`),
      );
    }

    const trackFrame = await browser.$('[role="treeitem"][data-layer-type="frame"]');
    await trackFrame.click();
    await browser.waitUntil(
      async () => (await trackFrame.getAttribute('aria-selected')) === 'true',
      {
        timeout: 5_000,
        timeoutMsg: 'the frame must be selected before editing its tracks',
      },
    );
    const layoutDisclosure = await browser.$(
      '//button[contains(normalize-space(.), "Stack / Grid")]',
    );
    await layoutDisclosure.waitForDisplayed({ timeout: 5_000 });
    if ((await layoutDisclosure.getAttribute('aria-expanded')) !== 'true') {
      await layoutDisclosure.click();
    }
    const frameLayoutState = await browser.execute(() => ({
      selected: Array.from(
        document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected="true"]'),
      ).map((row) => row.getAttribute('aria-label')),
      layoutSummary: document.querySelector('[role="button"][aria-label*="Stack / Grid"]')
        ?.textContent,
      layoutMode: document.querySelector('[aria-label="Layout mode"]')?.textContent,
      trackEditor: Boolean(document.querySelector('.insp-grid-track-editor')),
      layoutControls: Boolean(document.querySelector('.insp-layout-controls')),
    }));
    if (!frameLayoutState.trackEditor) throw new Error(JSON.stringify(frameLayoutState));
    await browser.setWindowSize(900, 600);
    const columnTrackCount = async () =>
      await (await browser.$$('.insp-grid-track-editor__axis[aria-label="column tracks"] input'))
        .length;
    await browser.waitUntil(async () => (await columnTrackCount()) === 2, {
      timeout: 10_000,
      timeoutMsg: 'the authored two-column editor did not appear',
    });
    expect(await columnTrackCount()).toBe(2);
    await (await browser.$('button=Add column')).click();
    await browser.waitUntil(async () => (await columnTrackCount()) === 3, {
      timeout: 5_000,
      timeoutMsg: 'adding a column did not add one editable track',
    });
    await browser.saveScreenshot(join(dirname(screenshotPath), 'grid-track-controls-900x600.png'));
    await browser.setWindowSize(820, 600);
    const compact = await browser.execute(() => ({
      viewportWidth: window.innerWidth,
      controls: Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '.insp-grid-track-editor__axis[aria-label="column tracks"] button[aria-label^="Move column"]',
        ),
      ).map((button) => {
        const bounds = button.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width, right: bounds.right };
      }),
    }));
    // The packaged desktop window declares minWidth 900; a request for 820
    // must be checked against the effective WebKit viewport, not mislabeled
    // as an 820px native capture. The browser project covers 820px directly.
    console.log('Native compact track control bounds:', JSON.stringify(compact));
    expect(compact.viewportWidth).toBeGreaterThanOrEqual(900);
    expect(compact.controls.length).toBeGreaterThan(0);
    for (const bounds of compact.controls) {
      expect(bounds.width).toBeLessThanOrEqual(30);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(compact.viewportWidth);
    }
    await browser.setWindowSize(900, 600);
    await (await browser.$('button[aria-label="Remove column 3"]')).click();
    const removalDialog = await browser.$('.insp-grid-track-editor__dialog');
    await removalDialog.waitForDisplayed({ timeout: 5_000 });
    await browser.saveScreenshot(
      join(dirname(screenshotPath), 'grid-track-removal-preview-900x600.png'),
    );
    await (await removalDialog.$('button=Cancel')).click();
    await removalDialog.waitForDisplayed({ reverse: true, timeout: 5_000 });
    expect(await columnTrackCount()).toBe(3);
    await browser.execute(() => document.body.focus());
    await browser.keys(['Control', 'z']);
    await browser.waitUntil(async () => (await columnTrackCount()) === 2, {
      timeout: 5_000,
      timeoutMsg: 'the single undo did not restore the previous grid tracks',
    });
  });
});
