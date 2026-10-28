/** Scene data: workspace, presentation, tablet, vector, and typography captures. */
import { expect } from '@playwright/test';
import { fitContent, openCleanEditor, openDemoDocument, selectLayer } from '../editor.mjs';

export const FOUNDATION_SCENES = [
  {
    id: 'guide-layouts',
    file: 'guide-layouts-light.png',
    theme: 'light',
    feature: 'canvas',
    alt: 'Varve Guide Layouts dialog previewing a column layout over a frame without moving its content',
    caption: 'Preview columns, rows, and square grids before applying them',
    async run(page) {
      await openCleanEditor(page);
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('canvas bounds unavailable for guide-layout capture');
      await page.keyboard.press('f');
      await page.mouse.move(box.x + 180, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 620, box.y + 430, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.press('v');
      await page.getByRole('menuitem', { name: 'View', exact: true }).click();
      const viewMenu = page.getByRole('menu', { name: 'View' });
      await viewMenu.getByRole('menuitem', { name: 'Guides', exact: true }).hover();
      await page
        .getByRole('menuitem', { name: /^Guide Layouts/ })
        .first()
        .click();
      await expect(page.getByRole('dialog', { name: 'Guide Layouts' })).toBeVisible();
    },
  },
  {
    id: 'workspace',
    file: 'workspace-light.png',
    theme: 'light',
    feature: 'home-showcase',
    alt: 'The Varve workspace: a poster document on the canvas with the layers panel on the left and the properties inspector on the right',
    caption: 'One window — canvas, layers, and properties',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
    },
  },
  {
    id: 'workspace-dark',
    file: 'workspace-dark.png',
    theme: 'dark',
    feature: 'home-showcase',
    alt: 'The same Varve poster document with the application in dark theme',
    caption: 'The same document in dark theme',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
    },
  },
  {
    id: 'presentation-navigator',
    file: 'presentation-navigator-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Varve Design showing an ordered three-slide presentation in the Slides navigator beside the editable canvas',
    caption: 'An explicit slide sequence beside the editable Design canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      const slides = page.getByRole('list', { name: 'Slides in presentation order' });
      await expect(slides.locator(':scope > li')).toHaveCount(3);
      await expect(page.locator('.presentation-navigator__thumbnail img').first()).toBeVisible({
        timeout: 30000,
      });
    },
  },
  {
    id: 'presentation-slide',
    file: 'presentation-slide-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'An editable title slide on the Varve Design canvas, with layered teal, sand, and terracotta bars',
    caption: 'Each slide remains an editable frame on the Design canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page
        .getByRole('button', { name: /Edit slide/ })
        .first()
        .click();
      await page.locator('.editor-canvas__content-layer').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'presentation-layout-revision',
    file: 'presentation-layout-revision-tablet-dark.png',
    theme: 'dark',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    feature: 'presentations',
    alt: 'Varve showing a preview of reusable presentation layout geometry before applying the revision',
    caption: 'Review compatible layout geometry before reapplying it to a slide',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.locator('.presentation-layouts > summary').click();
      await page.getByRole('combobox', { name: 'Layout source' }).click();
      await page.getByRole('option', { name: 'Title / section', exact: true }).click();
      await page.getByRole('combobox', { name: 'Slide object for title' }).click();
      await page.getByRole('option', { name: 'Headline', exact: true }).click();
      await page.getByRole('button', { name: 'Preview and reapply…' }).click();
      await expect(page.getByRole('dialog', { name: 'Review layout changes' })).toContainText(
        'geometry changes',
      );
    },
  },
  {
    id: 'presentation-preview',
    file: 'presentation-preview-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Audience preview displaying a Varve presentation slide without editor dock controls',
    caption: 'Audience preview hides the editing docks; speaker notes stay private',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.getByRole('button', { name: 'Present', exact: true }).click();
      const audience = page.getByRole('dialog', { name: /audience preview/ });
      await expect(audience.locator('.presentation-audience__image')).toBeVisible({
        timeout: 30000,
      });
      await expect(audience).not.toContainText('Internal note:');
    },
  },
  {
    id: 'presentation-export',
    file: 'presentation-export-light.png',
    theme: 'light',
    feature: 'presentations',
    alt: 'Varve presentation export dialog showing raster PDF and ordered PNG sequence output options',
    caption: 'Export an ordered raster PDF or PNG sequence from the local deck',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'presentation');
      await page.getByRole('tab', { name: 'Slides' }).click();
      await page.getByRole('button', { name: 'Export deck…' }).click();
      const exportDialog = page.getByRole('dialog', { name: /Export Local field notes/ });
      await expect(exportDialog.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
      await expect(exportDialog.getByRole('button', { name: 'Export PNG sequence' })).toBeEnabled();
    },
  },
  {
    id: 'tablet-workspace',
    file: 'tablet-workspace-light.png',
    theme: 'light',
    feature: 'tablet-editing',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    alt: 'The Varve poster workspace in tablet presentation, with the Inspector beside the canvas and touch controls along the bottom toolbar',
    caption: 'Touch-sized controls and keyboardless editing actions beside the canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
      const inspector = page.locator('.editor__inspector-panel');
      await expect(inspector).toBeVisible();
    },
  },
  {
    id: 'tablet-controls',
    file: 'tablet-controls-detail-light.png',
    theme: 'light',
    feature: 'tablet-editing',
    viewport: { width: 1200, height: 750 },
    hasTouch: true,
    alt: 'Tablet editing controls for modifiers, multi-selection, alignment, and layer order beside a Varve poster canvas',
    caption:
      'Constrain, draw from centre, bypass snapping, duplicate, align, and reorder without a keyboard',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      const bodyCopy = page.getByRole('treeitem').filter({ hasText: /body copy/i });
      await bodyCopy.click({ modifiers: ['Shift'] });
      const multiSelectHint = page.getByRole('button', { name: 'Dismiss hint' });
      if (await multiSelectHint.isVisible({ timeout: 1000 }).catch(() => false)) {
        await multiSelectHint.click();
      }
      await fitContent(page);
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
      await page.getByRole('button', { name: 'Tablet editing controls' }).click();
      const controls = page.getByRole('dialog', { name: 'Tablet editing controls' });
      await expect(controls).toBeVisible();
      await expect(controls.getByRole('button', { name: 'Duplicate' })).toBeEnabled();
      await expect(controls.getByRole('button', { name: 'Align left' })).toBeEnabled();
    },
  },
  {
    id: 'vector',
    file: 'vector-light.png',
    theme: 'light',
    feature: 'vector-tools',
    clipFrom: { selector: '.editor-canvas' },
    alt: 'A curved vector shape in Varve with its anchor points and Bézier handles shown in node editing mode',
    caption: 'Node editing with live Bézier handles',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'vector');
      await selectLayer(page, /petal/i);
      await fitContent(page);
      const editNodes = page
        .locator('.selection-quick-bar')
        .getByRole('button', { name: /edit nodes/i });
      if (!(await editNodes.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('node editing unavailable: no "Edit nodes" control for the selected path');
      }
      await editNodes.click();
      // Keep the handles above the node-controls tray in this detail crop.
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.getByRole('button', { name: 'Zoom out' }).click();
      // The node controls float over the canvas. Pan the artwork clear of
      // that tray so this image shows the complete path and its live handles.
      // Start outside the tray itself and use the persistent Hand tool. Using
      // Space here is unreliable because toolbar focus can keep the shortcut
      // outside the canvas input pipeline.
      const canvas = await page.locator('.editor-canvas').boundingBox();
      if (!canvas) throw new Error('Vector capture canvas geometry missing');
      const panStart = {
        x: canvas.x + canvas.width - 24,
        y: canvas.y + canvas.height * 0.75,
      };
      const toolbar = page.getByTestId('toolbar');
      await toolbar.locator('[data-tool="hand"]').first().click();
      await page.mouse.move(panStart.x, panStart.y);
      await page.mouse.down();
      await page.mouse.move(panStart.x, panStart.y - 150, { steps: 10 });
      await page.mouse.up();
      await toolbar.locator('[data-tool="select"]').first().click();
      await editNodes.click();
      await page.waitForTimeout(700);
    },
    async verify(page) {
      const nodes = page.getByTestId('node-edit-overlay').locator('[data-node-anchor]');
      await expect(nodes.first()).toBeVisible();
      const bounds = await nodes.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
      );
      const tray = await page.locator('.node-edit-controls').boundingBox();
      const canvas = await page.locator('.editor-canvas').boundingBox();
      if (!tray || !canvas || bounds.length === 0) throw new Error('Node editing geometry missing');
      const clearance = 8;
      for (const box of bounds) {
        const overlapsTray =
          box.x + box.width > tray.x - clearance &&
          box.x < tray.x + tray.width + clearance &&
          box.y + box.height > tray.y - clearance &&
          box.y < tray.y + tray.height + clearance;
        if (
          box.x < canvas.x ||
          box.x + box.width > canvas.x + canvas.width ||
          box.y < canvas.y ||
          box.y + box.height > canvas.y + canvas.height ||
          overlapsTray
        ) {
          throw new Error('A vector anchor or handle is clipped or covered by the node controls');
        }
      }
    },
  },
  {
    id: 'typography',
    file: 'typography-light.png',
    theme: 'light',
    feature: 'typography',
    clipFrom: { selector: '.editor-canvas' },
    alt: 'A type specimen in Varve showing a display character, a character set, a subhead and a body paragraph',
    caption: 'A type hierarchy set on the canvas',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'type');
      // Select only to drive the fit, then drop the selection: the floating
      // quick bar anchors under the selected node and covers the body
      // paragraph this scene is meant to show.
      await selectLayer(page, /subhead/i);
      await fitContent(page);
      // Escape exits the tool but keeps the selection, so clear it by
      // clicking empty canvas above/left of the specimen card.
      await page.keyboard.press('v');
      // The fitted specimen fills its Page. Zoom back just enough to make a
      // click outside the Page possible; its outer ruler gutters are not part
      // of the drawing surface and cannot clear the selection.
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await page.waitForTimeout(350);
      const canvasBox = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
      if (!canvasBox) throw new Error('canvas bounding box unavailable');
      const quickBar = page.locator('.selection-quick-bar');
      // SelectTool deselects on a click that lands on empty canvas, so aim
      // well clear of both the fitted artwork and the floating toolbar
      // (bottom-centre). The document's own top-left corner is not empty —
      // clicking there just selects the frame and keeps the bar up.
      for (const [dx, dy] of [[40, 140]]) {
        await page.mouse.click(canvasBox.x + dx, canvasBox.y + dy);
        await page.waitForTimeout(600);
        if (!(await quickBar.isVisible({ timeout: 1000 }).catch(() => false))) break;
      }
      // Empty-space clicks are the primary gesture; Escape is the explicit
      // keyboard path and keeps this specimen clear if the fit camera places
      // an off-screen frame beneath either trial point.
      if (await quickBar.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
      if (await quickBar.isVisible({ timeout: 1000 }).catch(() => false)) {
        throw new Error('selection quick bar still visible — it would cover the specimen text');
      }
    },
  },
];
