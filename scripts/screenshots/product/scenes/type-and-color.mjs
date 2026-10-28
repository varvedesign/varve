/** Scene data: typography panel, layout, layers, motion, and color-effect captures. */
import { expect } from '@playwright/test';
import {
  fitContent,
  importImage,
  openCleanEditor,
  openDemoDocument,
  selectImageNode,
  selectLayer,
} from '../editor.mjs';

export const TYPE_AND_COLOR_SCENES = [
  {
    id: 'typography-panel',
    file: 'typography-panel-light.png',
    theme: 'light',
    feature: 'typography',
    clipFrom: { selector: '.editor__inspector-panel' },
    alt: 'The Varve properties inspector showing typography controls: font family, weight, style, size, line height and letter spacing',
    caption: 'Type controls for the selected text',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      await selectLayer(page, /subhead/i);
      await fitContent(page);
      // Typography is order 300 in the section registry, so it renders well
      // below the fold — an unscrolled inspector crop shows Position & Size
      // and Fill instead, which is not what this scene claims to show.
      const typography = page.locator('.insp-disclosure').filter({ hasText: /^Typography/ });
      if (!(await typography.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('Typography section not present for the selected text node');
      }
      await typography.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      // Keep the section heading above its fields. Scrolling the first label
      // to the rail's top would put it behind the sticky disclosure header.
      await typography
        .getByText(/^Font family$/)
        .first()
        .evaluate((label) => {
          const rail = label.closest('.insp-panel');
          const header = label
            .closest('.insp-disclosure')
            ?.querySelector('.insp-disclosure__header');
          if (!(rail instanceof HTMLElement) || !header)
            throw new Error('Typography scroll rail unavailable');
          rail.scrollTop +=
            label.getBoundingClientRect().top -
            rail.getBoundingClientRect().top -
            header.getBoundingClientRect().height -
            8;
        });
      const familyClearOfHeader = await typography
        .getByText(/^Font family$/)
        .first()
        .evaluate((label) => {
          const header = label
            .closest('.insp-disclosure')
            ?.querySelector('.insp-disclosure__header');
          return (
            header && label.getBoundingClientRect().top >= header.getBoundingClientRect().bottom
          );
        });
      if (!familyClearOfHeader) throw new Error('Font family is covered by the typography header');
      // Assert the controls the alt text promises are really on screen.
      // NumberField renders its label with the unit appended ("Size (px)"),
      // so these match on prefix rather than exact text.
      for (const label of [
        /^Font family$/,
        /^Weight$/,
        /^Size \(/,
        /^Line height/,
        /^Letter spacing/,
      ]) {
        const row = typography.getByText(label).first();
        await expect(row, `Typography control ${label} must appear in the capture`).toBeInViewport({
          ratio: 1,
        });
      }
    },
  },
  {
    id: 'font-toolbar',
    preserveFocus: true,
    async verify(page) {
      await expect(page.getByRole('listbox', { name: 'Font families' })).toBeVisible();
    },
    file: 'font-toolbar-light.png',
    theme: 'light',
    feature: 'typography',
    alt: 'The floating text formatting toolbar with its font family menu open during text editing',
    caption: 'Choose a font while editing text',
    async run(page) {
      await openCleanEditor(page);
      const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
      if (!box) throw new Error('Canvas has no bounds');
      await page.keyboard.press('t');
      await page.mouse.click(box.x + 180, box.y + 220);
      await expect(page.getByRole('textbox', { name: /editing text/i })).toBeFocused();
      await page.keyboard.insertText('Make room for good type.');
      const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
      await page.locator('.micro-hint').waitFor({ state: 'hidden' });
      await toolbar.getByRole('combobox', { name: 'Font family' }).click();
      await expect(page.getByRole('listbox', { name: 'Font families' })).toBeVisible();
      await expect(page.getByRole('option', { name: /IBM Plex Sans/ })).toBeVisible();
    },
  },
  {
    id: 'font-browser',
    file: 'font-browser-light.png',
    theme: 'light',
    feature: 'typography',
    alt: 'Browse fonts with a family list and a local specimen alongside font details',
    caption: 'Browse families and inspect a local specimen',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      await selectLayer(page, /subhead/i);
      await page.getByRole('button', { name: 'Browse fonts', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Browse fonts', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Preview text').fill('Make room for good type.');
      await expect(dialog.locator('.font-browser__specimen')).toHaveText(
        'Make room for good type.',
      );
    },
  },
  {
    id: 'layout',
    file: 'layout-light.png',
    theme: 'light',
    feature: 'layout',
    alt: 'A two-page editorial spread in Varve with headlines, two-column body text and image plates',
    caption: 'A multi-page editorial spread',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'layout');
      await selectLayer(page, /page 12/i);
      await fitContent(page);
    },
  },
  {
    id: 'layers',
    file: 'layers-light.png',
    theme: 'light',
    feature: 'canvas',
    // A taller window lets the panel's layer tree take its flex space instead
    // of being squeezed to its 160px minimum by the sections below it, so the
    // crop shows complete rows rather than one clipped at the bottom edge.
    viewport: { width: 1440, height: 1200 },
    // Measured from the panel's own header through its layer tree. A fixed
    // window here went stale when the panel gained a "Design Canvases" section
    // above the list, so the crop started framing that section instead.
    clipFrom: {
      selector: '.editor__layers-panel',
      top: '.layers-panel__header',
      bottom: '.layers-panel__tree',
    },
    alt: 'The Varve layers panel listing the poster’s named layers, with a blend-mode badge on the Disc layer and opacity badges on the tinted bands',
    caption: 'Layers, blend modes, and opacity',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /disc/i);
      await fitContent(page);
    },
    async verify(page) {
      // The caption claims blend/opacity badges, so at least one layer row with
      // a badge has to be inside the measured crop, not merely somewhere in the
      // panel's scroll extent.
      const tree = page.locator('.layers-panel__tree');
      await expect(tree.getByRole('treeitem').first()).toBeVisible();
      await expect(tree.getByText(/Multiply/).first()).toBeVisible();
      await expect(tree.getByText(/%/).first()).toBeVisible();
    },
  },
  {
    id: 'motion',
    file: 'motion-dark.png',
    theme: 'dark',
    feature: 'motion',
    alt: 'The Varve Motion workspace with the poster document above an editable position track and keyframe in the shared timeline',
    caption:
      'Author position tracks and keyframes in the Motion workspace beside the same document.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      const motionTab = page
        .getByRole('radiogroup', { name: 'Workspace' })
        .getByRole('radio', { name: 'Motion workspace', exact: true });
      await motionTab.click();
      await expect(motionTab).toHaveAttribute('aria-checked', 'true');
      await fitContent(page);
      await selectLayer(page, /disc/i);
      const panel = page.locator('.timeline-panel');
      if (!(await panel.isVisible().catch(() => false))) {
        await page.keyboard.press('Control+Alt+t');
      }
      await panel.waitFor({ state: 'visible', timeout: 8000 });
      const createBtn = page
        .getByTestId('timeline-create-empty')
        .or(page.getByTestId('timeline-create'));
      await createBtn
        .first()
        .click({ timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(600);
      // Author a real keyframe: Alt+P is the app's own "Add Position
      // Keyframe" shortcut and creates the first track for the selected
      // layer. Without a track the timeline would show an empty state that
      // does not honestly illustrate the motion workspace.
      await page.keyboard.press('Alt+p');
      await page.waitForTimeout(900);
      const empty = await page
        .locator('.timeline-panel')
        .getByText(/no tracks in this timeline/i)
        .isVisible({ timeout: 1500 })
        .catch(() => false);
      if (empty) {
        throw new Error(
          'timeline has no tracks: the Alt+P keyframe shortcut did not author a track, so the scene would misrepresent the motion workspace',
        );
      }
      await expect(panel).toBeInViewport({ ratio: 1 });
      await expect
        .poll(async () => (await panel.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(600);
      await expect(panel.locator('.timeline-track-row').first()).toBeInViewport({ ratio: 1 });
      await expect(panel.locator('.timeline-track-row__keyframe').first()).toBeInViewport({
        ratio: 1,
      });
    },
  },
  {
    id: 'palette-inspector',
    file: 'palette-inspector-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing a NASA Earth-observation photo beside its extracted palette, with HEX swatches and controls to save swatches or color tokens',
    caption: 'Extract an image palette locally, review the swatches, and save colors for reuse.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await page.keyboard.press('Control+Shift+4');
      await page.waitForTimeout(1000);
      await page.getByRole('tab', { name: /^Design/i }).click();
      // The Design/Properties surface re-renders on tab switch; querying the
      // disclosure immediately after the click can catch it mid-render.
      await page.waitForTimeout(400);
      const paletteSection = page
        .locator('.insp-disclosure')
        .filter({ hasText: /^Extract Palette/ });
      await paletteSection.waitFor({ state: 'visible', timeout: 15000 });
      const paletteTrigger = paletteSection.getByRole('button', { name: /^Extract Palette$/ });
      if ((await paletteTrigger.getAttribute('aria-expanded')) === 'false') {
        await paletteTrigger.click();
        await page.waitForTimeout(500);
      }
      // Wait for the actual loading -> idle transition rather than a fixed
      // sleep or the heading's own timeout: analysis runs in a worker and
      // briefly shows "Analyzing...", and waiting for that round trip is the
      // real deterministic signal, not an arbitrary delay.
      const analyzeBtn = paletteSection.locator(
        '.palette-section__toolbar .intelligence-action-btn',
      );
      await analyzeBtn
        .filter({ hasText: /Analyzing/i })
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => undefined);
      await analyzeBtn
        .filter({ hasText: /^Analyze$/ })
        .waitFor({ state: 'visible', timeout: 20000 })
        .catch(() => undefined);
      const heading = paletteSection.getByRole('heading', { name: 'Extracted colors' });
      if (!(await heading.isVisible({ timeout: 10000 }).catch(() => false))) {
        throw new Error(
          'palette extraction did not produce "Extracted colors" for the photo fixture',
        );
      }
      const result = paletteSection.locator('.palette-section__result');
      await result.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      const swatches = paletteSection.getByRole('list', { name: 'Extracted colors' });
      await expect(swatches).toBeInViewport({ ratio: 1 });
      await expect(
        paletteSection.getByRole('button', { name: 'Save extracted swatches' }),
      ).toBeInViewport();
      await expect(
        paletteSection.getByRole('button', { name: 'Save as color tokens' }),
      ).toBeInViewport();
    },
  },
  {
    id: 'solid-picker',
    file: 'solid-picker-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing the shared solid color picker beside the selected headline, with the color area, hue and opacity ramps, and aligned HEX and alpha fields visible',
    caption: 'Set a solid colour with the colour area, hue and opacity ramps, and precise fields.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const swatch = page.getByRole('button', { name: 'Fill colour', exact: true });
      await swatch.waitFor({ state: 'visible', timeout: 8000 });
      await swatch.click();
      await page.getByRole('dialog', { name: /pick fill colour/i }).waitFor({
        state: 'visible',
        timeout: 8000,
      });
    },
  },
];
