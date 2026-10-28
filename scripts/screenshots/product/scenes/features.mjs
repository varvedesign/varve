/** Scene data: depth, image-tools, workspaces, shared workflows, and print captures. */
import { expect } from '@playwright/test';
import {
  activatePageTool,
  expandSection,
  fitContent,
  importImage,
  openCleanEditor,
  openDemoDocument,
  openImageToolsTab,
  selectImageNode,
  selectLayer,
  waitForInferenceResult,
} from '../editor.mjs';

export const FEATURE_SCENES = [
  {
    id: 'depth-blur',
    requiresEnv: 'VARVE_SHOT_MODELS',
    file: 'depth-blur-light.png',
    theme: 'light',
    feature: 'depth-aware-effects',
    alt: 'The Varve Depth Blur inspector showing depth-map controls for a photo, with blur amount, focal distance and transition range controls',
    caption: 'A depth map computed on-device drives a non-destructive lens blur.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await openImageToolsTab(page);
      const section = await expandSection(page, /^Depth Blur/);
      const generate = section.getByRole('button', { name: /generate depth map/i });
      if (!(await generate.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('Depth Blur offers no "Generate Depth Map" action — model likely missing');
      }
      await generate.click();
      // The heatmap canvas is intentionally hidden until Preview Depth is
      // checked, so it cannot be the inference completion signal. The
      // persistent subsection label appears as soon as generation succeeds.
      const ready = section.getByText(/^Depth Map Preview$/);
      // The optional INT8 model is CPU/WASM-preferred even though the capture
      // browser uses Vulkan for renderer/WebGPU diagnostics: minutes, not
      // seconds.
      const result = await waitForInferenceResult(ready, section, 900000);
      if (result !== 'success') {
        const state = (await section.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, 240);
        const detail = typeof result === 'object' ? ` — error: ${result.error || 'unknown'}` : '';
        throw new Error(`depth map never rendered${detail} — panel read: ${state}`);
      }
      const previewToggle = section.getByRole('switch', { name: /preview depth/i });
      await expect(previewToggle).toBeVisible();
      await previewToggle.check();
      await ready.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect(section.locator('.insp-depth-heatmap__canvas')).toBeInViewport({ ratio: 1 });
      for (const label of ['Blur amount', 'Focal distance', 'Transition range']) {
        await expect(section.getByRole('slider', { name: label, exact: true })).toBeInViewport({
          ratio: 1,
        });
      }
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 'image-tools',
    file: 'image-tools-panel-light.png',
    theme: 'light',
    feature: 'visual-awareness',
    clipFrom: { selector: '.editor__inspector-panel' },
    alt: 'The Varve Photo Adjustments inspector with an Effect Studio link, Image Tuning guidance, and photo treatment presets for the selected image',
    caption: 'Review photo treatment presets or open Effect Studio for the selected image.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const tab = page.getByRole('tab', { name: /^Adjustments/i });
      if (!(await tab.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('image tools tab unavailable for the selected image');
      }
      await tab.click();
      // The panel is lazy-loaded; wait for real controls rather than the tab
      // click alone, or the crop can land on a loading fallback.
      await page.locator('.insp-disclosure').first().waitFor({ state: 'visible', timeout: 15000 });
      await expect(
        page.getByRole('button', { name: 'Open Effect Studio', exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole('button', { name: 'Apply photo preset Natural Detail', exact: true }),
      ).toBeInViewport();
      await page.waitForTimeout(700);
    },
  },
  {
    id: 'workspaces',
    file: 'workspaces-light.png',
    theme: 'light',
    feature: 'workspaces',
    alt: 'The Varve menubar workspace switcher with the Print workspace selected, showing the panel and toolbar layout that workspace applies',
    caption:
      'Six task workspaces in keyboard order — Print selected with its own panels, toolbar, and inspector.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const group = page.getByRole('radiogroup', { name: 'Workspace' });
      await group.waitFor({ state: 'visible', timeout: 8000 });
      const workspaceOrder = await group
        .getByRole('radio')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')));
      const expectedOrder = [
        'Design workspace',
        'Print workspace',
        'Draw workspace',
        'Photo workspace',
        'Motion workspace',
        'Email workspace',
      ];
      if (JSON.stringify(workspaceOrder) !== JSON.stringify(expectedOrder)) {
        throw new Error(`Workspace switcher order mismatch: ${workspaceOrder.join(', ')}`);
      }
      const printTab = group.getByRole('radio', { name: /print workspace/i });
      if (!(await printTab.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Print workspace tab not present in the workspace switcher');
      }
      await printTab.click();
      // requestWorkspaceSwitch is async and re-lays out the shell; assert the
      // switch actually took rather than capturing mid-transition.
      await page.waitForTimeout(1200);
      if ((await printTab.getAttribute('aria-checked')) !== 'true') {
        throw new Error('Print workspace did not become the active workspace after the click');
      }
      await fitContent(page);
    },
  },
  {
    id: 'workspace-shared-workflows',
    file: 'workspace-shared-workflows-light.png',
    theme: 'light',
    feature: 'workspaces',
    kind: 'detail',
    // Capture a native 4:3 compact desktop viewport. The previous 936x900
    // frame made the homepage card denser than adjacent detail captures; a
    // real viewport reflows the canvas chrome instead of cropping controls.
    viewport: { width: 936, height: 702 },
    alt: 'The Design workspace with Logo project controls and generated Code output open beside the same poster document',
    caption:
      'Logo tools stay in Design; the shared Code panel remains available alongside the same document.',
    async run(page) {
      // Start the document at the canonical desktop size so Fit All remains
      // available, then switch to the intentionally compact 4:3 capture
      // viewport after framing.
      await page.setViewportSize({ width: 1440, height: 900 });
      const trace = (step) => {
        if (process.env.VARVE_SHOT_DEBUG) {
          console.log(`  [workspace-shared-workflows:step] ${step}`);
        }
      };
      await openCleanEditor(page);
      trace('editor ready');
      await openDemoDocument(page, 'poster');
      trace('poster opened');
      await fitContent(page);
      trace('poster fit');
      // At this width the dock min-size guard exercises the same recoverable
      // compact projection used in the responsive E2E, rather than stretching
      // a saved desktop split over the canvas when three task panels are open.
      await page.setViewportSize({ width: 936, height: 702 });
      await page.waitForTimeout(250);
      const zoomInput = page.locator('#status-zoom');
      await zoomInput.fill('30');
      await zoomInput.press('Enter');
      await zoomInput.evaluate((input) => input.blur());
      await page.waitForTimeout(500);
      trace('viewport and zoom set');
      await page.keyboard.press('Control+Shift+7');
      await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const logo = page.getByTestId('logo-panel');
      await logo.waitFor({ state: 'visible', timeout: 15000 });
      trace('Logo Tools shown');
      const startProject = logo.getByRole('button', { name: /Start a logo project/i });
      if (await startProject.isVisible().catch(() => false)) await startProject.click();
      const brandName = logo.getByLabel('Brand name');
      await brandName.fill('Varve');
      // Workspace commands intentionally respect text-entry focus. Commit the
      // brand edit before invoking the shared Code workflow shortcut.
      await brandName.evaluate((input) => input.blur());
      trace('Logo project edited');
      await page.keyboard.press('Control+Shift+8');
      const code = page.locator('[data-panel="codegen"]');
      await code.waitFor({ state: 'visible', timeout: 15000 });
      await code.locator('.code-panel__line').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
      trace('shared Code shown');
    },
    async verify(page) {
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const [shell, logo, code] = await Promise.all([
        page.locator('.editor-shell').boundingBox(),
        page.locator('[data-panel="logo"]').boundingBox(),
        page.locator('[data-panel="codegen"]').boundingBox(),
      ]);
      expect(viewportWidth).toBe(936);
      expect(shell).not.toBeNull();
      expect(logo).not.toBeNull();
      expect(code).not.toBeNull();
      expect(logo.x).toBeGreaterThanOrEqual(shell.x);
      expect(logo.x + logo.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
      expect(code.x).toBeGreaterThanOrEqual(shell.x);
      expect(code.x + code.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
      const unobstructedCanvasLeft = Math.max(shell.x, logo.x + logo.width);
      const unobstructedCanvasRight = Math.min(shell.x + shell.width, code.x);
      expect(unobstructedCanvasRight).toBeGreaterThanOrEqual(unobstructedCanvasLeft);
      expect(unobstructedCanvasRight - unobstructedCanvasLeft).toBeGreaterThanOrEqual(320);
    },
  },
  {
    id: 'print-production',
    file: 'print-production-light.png',
    theme: 'light',
    feature: 'print-production',
    // Leave the pointer in the empty gutter between the page and Inspector so
    // the responsive panel stays open without a hover effect in the capture.
    parkAt: { x: 1435, y: 500 },
    alt: 'A publishing page outlined by 20 px dashed bleed guides, with the Page Print inspector showing the same value on each edge',
    caption: 'Set equal per-edge bleed and check the print boundary on canvas.',
    async run(page) {
      // Bleed is a publishing-page property; this scene authors a real Page
      // and edits its per-edge values through the Page Print inspector.
      await openCleanEditor(page);
      const workspaceGroup = page.getByRole('radiogroup', { name: 'Workspace' });
      await workspaceGroup.waitFor({ state: 'visible', timeout: 8000 });
      const printWorkspace = workspaceGroup.getByRole('radio', { name: /print workspace/i });
      await printWorkspace.click();
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: 'Add publishing page' }).click();
      await page.waitForTimeout(400);
      const canvas = page.locator('canvas.editor-canvas__content-layer');
      await canvas.waitFor({ timeout: 10000 });

      const inspector = page.locator('.editor__inspector-panel');
      const showInspector = page.getByRole('button', { name: 'Show inspector panel' });
      // Fit the actual active page, including its camera center. Changing only
      // zoom kept the old pan and left the page far outside the screenshot.
      await page.getByRole('button', { name: 'Fit active page', exact: true }).click();
      await page.waitForTimeout(600);

      if (await showInspector.isVisible().catch(() => false)) {
        // The adjacent responsive FABs can overlap at their edges. Dispatch the
        // actual button click handler instead of letting pointer hit-testing
        // choose the neighboring launcher.
        await showInspector.evaluate((button) => button.click());
      }
      await inspector.waitFor({ state: 'visible', timeout: 8000 });

      await activatePageTool(page);
      const pageBounds = await page.locator('.page-tool-overlay > div').first().boundingBox();
      if (!pageBounds) throw new Error('Page tool did not expose the active page trim bounds');
      const pageCenter = {
        x: pageBounds.x + pageBounds.width / 2,
        y: pageBounds.y + pageBounds.height / 2,
      };
      await page.mouse.click(pageCenter.x, pageCenter.y);

      const pagePrintSection = page
        .locator('.insp-disclosure:visible')
        .filter({ hasText: 'Page Print' })
        .first();
      const pagePrintDisclosure = pagePrintSection
        .getByRole('button', { name: 'Page Print' })
        .first();
      await pagePrintDisclosure.waitFor({ state: 'visible', timeout: 8000 });
      if ((await pagePrintDisclosure.getAttribute('aria-expanded')) === 'false') {
        await pagePrintDisclosure.click();
      }
      const bleedTop = pagePrintSection.getByLabel(/bleed top/i);
      await bleedTop.fill('20');
      await pagePrintSection.getByLabel(/bleed right/i).fill('20');
      await pagePrintSection.getByLabel(/bleed bottom/i).fill('20');
      const bleedLeft = pagePrintSection.getByLabel(/bleed left/i);
      await bleedLeft.fill('20');
      await bleedLeft.press('Enter');

      const guide = page.locator('.print-bleed-guide');
      if ((await guide.count()) === 0) {
        await page
          .getByRole('menubar')
          .getByRole('menuitem', { name: /^View$/ })
          .click();
        const showGuides = page.getByRole('menuitem', { name: /show bleed guides/i });
        if (await showGuides.isVisible({ timeout: 1000 }).catch(() => false)) {
          await showGuides.click();
        }
      }
      await guide.waitFor({ state: 'attached', timeout: 5000 });
      if ((await guide.count()) === 0) {
        throw new Error('.print-bleed-guide did not mount after enabling View → Show Bleed Guides');
      }
      const inspectorBox = await inspector.boundingBox();
      if (!inspectorBox || inspectorBox.width < 100) {
        throw new Error('Inspector panel did not open to a usable width for the Print capture');
      }
      await bleedTop.waitFor({ state: 'visible', timeout: 8000 });
      await expect(bleedTop).toHaveValue('20');
      await expect(guide).toBeInViewport();
      const guideBounds = await guide.boundingBox();
      const canvasBounds = await canvas.boundingBox();
      if (!guideBounds || !canvasBounds || guideBounds.width < 300 || guideBounds.height < 150) {
        throw new Error('Bleed guide is not large enough to review on the fitted page');
      }
      if (
        guideBounds.x < canvasBounds.x ||
        guideBounds.y < canvasBounds.y ||
        guideBounds.x + guideBounds.width > canvasBounds.x + canvasBounds.width ||
        guideBounds.y + guideBounds.height > canvasBounds.y + canvasBounds.height
      ) {
        throw new Error('Bleed guide extends outside the captured canvas');
      }
    },
  },
];
