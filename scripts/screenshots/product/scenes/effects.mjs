/** Scene data: gradient, enhancement, export, vectorize, effects, and background-removal captures. */
import { expect } from '@playwright/test';
import {
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

export const EFFECT_SCENES = [
  {
    id: 'gradient-picker',
    file: 'gradient-picker-light.png',
    theme: 'light',
    feature: 'color-effects',
    alt: 'Varve showing teal and sand gradient stops in the shared picker, with the selected stop color controls and live gradient handles on the headline',
    caption: 'Edit gradient stops with shared color controls and live handles on the artwork.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /display headline/i);
      await fitContent(page);
      const fillType = page.getByRole('combobox', { name: 'Fill type', exact: true });
      await fillType.waitFor({ state: 'visible', timeout: 8000 });
      await fillType.click();
      await page.getByRole('option', { name: 'Gradient', exact: true }).click();
      const swatch = page.getByRole('button', { name: 'Fill gradient', exact: true });
      await swatch.waitFor({ state: 'visible', timeout: 8000 });
      await swatch.click();
      const dialog = page.getByRole('dialog', { name: /pick fill gradient/i });
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
      const options = dialog.getByRole('button', { name: 'Gradient options', exact: true });
      await options.click();
      await expect(options).toHaveAttribute('aria-expanded', 'true');
      const interpolation = dialog.getByRole('combobox', { name: 'Gradient interpolation space' });
      await interpolation.scrollIntoViewIfNeeded();
      await expect(interpolation).toBeInViewport();
      // Author distinguishable colors through the real fields, then frame the
      // stop bar and current color. The scrollable options cannot all appear
      // in this bounded picker at once, so the caption describes the visible
      // controls rather than promising the options below the capture fold.
      for (const [index, color] of [
        [1, '#249d94'],
        [2, '#e28c3c'],
      ]) {
        await dialog.getByRole('button', { name: new RegExp(`^Stop ${index} at`) }).click();
        const hex = dialog.getByRole('textbox', { name: 'Hex color' });
        await hex.fill(color);
        await hex.press('Enter');
        await hex.evaluate((input) => input.blur());
        await expect(hex).toHaveValue(new RegExp(`^${color}$`, 'i'));
      }
      const firstStop = dialog.getByRole('button', { name: /^Stop 1 at.*249d94/i });
      await firstStop.click();
      await options.click();
      await expect(options).toHaveAttribute('aria-expanded', 'false');
      await dialog.locator('.insp-picker-dialog__body').evaluate((element) => {
        element.scrollTop = 0;
      });
      // Frame to the Hex field's bottom edge, rounding up because scrollTop
      // uses whole pixels while DOM bounds can be fractional. Extra padding
      // scrolls the first stop above the body; keep both controls fully visible.
      const hex = dialog.getByRole('textbox', { name: 'Hex color' });
      const hexBottom = await hex.evaluate((element) => element.getBoundingClientRect().bottom);
      await dialog.locator('.insp-picker-dialog__body').evaluate((element, bottom) => {
        element.scrollTop += Math.max(
          0,
          Math.ceil(bottom - element.getBoundingClientRect().bottom),
        );
      }, hexBottom);
      await expect(firstStop).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole('button', { name: /^Stop 2 at.*e28c3c/i })).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.getByRole('slider', { name: /^Gradient stop bar/ })).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toBeInViewport({ ratio: 1 });
    },
  },
  {
    id: 'enhance-dialog-auto',
    file: 'enhance-dialog-auto.png',
    theme: 'light',
    feature: 'image-enhancement',
    alt: 'The Varve Enhance dialog showing a large live before-and-after CPU upscale preview with focus and zoom controls',
    caption: 'Inspect a generated upscale beside the untouched source before applying it.',
    async run(page) {
      await openCleanEditor(page);
      // A visibly degraded derivative of the same rights-cleared photo (see
      // fixtures/PROVENANCE.md) — the clean source is accurately judged as
      // needing no restoration, which doesn't demonstrate what this dialog
      // actually does.
      await importImage(page, 'earth-noisy.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const enhanceBtn = page.getByRole('button', { name: 'Enhance', exact: true });
      if (!(await enhanceBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Enhance control unavailable for the selected image');
      }
      await enhanceBtn.click();
      const dialog = page.getByRole('dialog', { name: 'Enhance image' });
      await dialog.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(400);
      const recommendation = dialog.getByText(/Recommended:/);
      if (!(await recommendation.isVisible({ timeout: 20000 }).catch(() => false))) {
        throw new Error(
          'Enhance Auto analysis produced no "Recommended:" result for the photo fixture',
        );
      }
      // Keep the deterministic Auto analysis in the scene, then select the
      // model-free CPU path so the marketing frame demonstrates a real
      // generated comparison even when optional restoration weights are not
      // installed on the capture machine.
      await dialog.getByRole('combobox', { name: 'Enhancement operation' }).click();
      await page.getByRole('option', { name: 'Upscale', exact: true }).click();
      await dialog
        .getByAltText('Enhanced preview — same crop and output size as original')
        .waitFor({ state: 'visible', timeout: 20000 });
    },
  },
  {
    id: 'export',
    file: 'export-dialog-light.png',
    theme: 'light',
    feature: 'export',
    alt: 'The Varve Inspector Export tab showing Format and Code sub-tabs with quick export presets and generated output options',
    caption: 'Keep export presets and generated code beside the selected object in the Inspector.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      await selectLayer(page, /^Poster — A3$/);
      await fitContent(page);
      const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
        hasText: /^export$/i,
      });
      if (await exportTab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await exportTab.click();
      } else {
        const overflow = page.getByRole('button', { name: /More inspector tabs/ });
        await overflow.waitFor({ state: 'visible', timeout: 5000 });
        await overflow.click();
        await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
      }
      const exportPanel = page.locator('#insp-tabpanel-export');
      await exportPanel.waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(500);
    },
  },
  {
    id: 'vectorize',
    file: 'vectorize-dialog-light.png',
    theme: 'light',
    feature: 'vector-tools',
    alt: 'The Varve Vectorize dialog tracing an imported photograph into editable vector paths, with the overlay preview, path/point/hole diagnostics, and source-versus-vector view tabs',
    caption:
      'Trace an imported image into editable paths — entirely on-device, with prepare/overlay/vector previews before anything is committed.',
    async run(page) {
      await openCleanEditor(page);
      // The default Dialog caps at 42rem even in a taller viewport. This
      // rights-cleared 16:9 photograph keeps the genuine warning, complete
      // preview and diagnostics in the bounded preview column, with
      // Apply/Cancel in the dialog footer.
      // Source/license/hash: tests/e2e/fixtures/PROVENANCE.md.
      await importImage(page, '../../../tests/e2e/fixtures/real-life-noaa-deepwater.jpg');
      await selectImageNode(page);
      await fitContent(page);
      const vectorize = page
        .locator('.selection-quick-bar')
        .getByRole('button', { name: /vectorize/i });
      if (!(await vectorize.isVisible({ timeout: 4000 }).catch(() => false))) {
        throw new Error('Vectorize control unavailable for the selected image');
      }
      await vectorize.click();
      const dialog = page.getByRole('dialog', { name: /vectorize image/i });
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      // The dialog opens on the B&W "crisp black logo" preset. That is the
      // right default for line art and the wrong one for a photograph — it
      // traces this fixture into hundreds of paths and surfaces a complexity
      // warning. Colour mode is what a designer would actually pick here.
      // SegmentedControl renders a visually-hidden radio inside its label, so
      // the input has no clickable box of its own — check it directly.
      const colorMode = dialog.getByRole('radio', { name: 'Color', exact: true });
      if ((await colorMode.count()) === 0) {
        throw new Error('Vectorize colour mode control not present');
      }
      await colorMode.check({ force: true, timeout: 8000 });
      if (!(await colorMode.isChecked())) {
        throw new Error('Vectorize did not switch to colour mode');
      }
      // Colour mode re-runs the trace preview; wait for the diagnostics that
      // only render with a settled result instead of a fixed delay, so the
      // capture never shows the previous mode's (or an empty) preview.
      await dialog.locator('.vectorize__diagnostics').waitFor({ state: 'visible', timeout: 30000 });
      // The preview column is bounded to the dialog, so the warning, the
      // complete preview and the diagnostics are on screen together without any
      // scrolling, and Apply/Cancel live in the sticky footer. Never hide a
      // warning for a capture: assert it is visible and in frame below.
      await expect(warning).toBeVisible();
      await page.waitForTimeout(400);
      for (const element of [
        warning,
        dialog.locator('.vectorize__preview-controls'),
        dialog.locator('.vectorize__preview'),
        dialog.locator('.vectorize__diagnostics'),
        dialog.getByRole('button', { name: 'Apply trace', exact: true }),
        dialog.getByRole('button', { name: 'Cancel', exact: true }),
      ]) {
        await expect(element).toBeInViewport({ ratio: 1 });
      }
    },
  },
  {
    id: 'effects',
    file: 'effects-light.png',
    theme: 'light',
    feature: 'effects',
    // The shadow itself stays subtle on canvas: the Disc is a Multiply layer
    // at 85% and the shadow sits at 0.3 opacity, so the alt text describes
    // the controls rather than claiming a visible effect on the artwork.
    alt: 'The Varve Effects inspector with a drop shadow added to the selected shape on a poster, showing offset, blur, spread, opacity and blend-mode controls',
    caption: 'Stackable, non-destructive effects — drop shadow, blurs, glows, glitch and more.',
    async run(page) {
      await openCleanEditor(page);
      await openDemoDocument(page, 'poster');
      // Select then fit, never the reverse: selecting a layer zooms to it, so
      // a fit followed by a select lands at ~364% with the disc filling the
      // canvas — where a drop shadow is off-screen rather than demonstrated.
      await selectLayer(page, /disc/i);
      await fitContent(page);
      const design = page.getByRole('tab', { name: /^Design/i });
      if (!(await design.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('Design/Properties tab unavailable for the selected shape');
      }
      await design.click();
      await page.waitForTimeout(500);
      const effects = await expandSection(page, /^Layer Effects/);
      // Add a real drop shadow rather than screenshotting an empty section:
      // 'dropShadow' is the default in the "New effect type" select, and the
      // newly added row starts expanded so its controls are on screen.
      // The add control's accessible name has been both "Add" and
      // "Add effect"; match both so a copy change never silently downgrades
      // this scene to a skip (the effects panel review renamed it).
      const addBtn = effects.getByRole('button', { name: /^Add( effect)?$/ });
      await addBtn.click({ timeout: 5000 });
      await page.getByRole('menuitem', { name: 'Drop Shadow', exact: true }).click();
      await page.waitForTimeout(1200);
      await effects.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      const effectRow = effects.locator('.insp-effect-row').first();
      if ((await effectRow.count()) === 0) {
        throw new Error('no effect row after Add — the section would show an empty state');
      }
      const focusedEditor = page.locator('.insp-focused-editor').first();
      if (!(await focusedEditor.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('effect parameters did not open in the focused editor');
      }
      // The default 0/4/8 shadow is invisible on an A3 poster viewed whole.
      // Scale it to the artwork so the canvas actually shows the effect the
      // panel is describing.
      for (const [label, value] of [
        [/^Y$/, '28'],
        [/^Blur$/, '48'],
      ]) {
        const field = focusedEditor.getByLabel(label).first();
        if (!(await field.isVisible({ timeout: 4000 }).catch(() => false))) {
          throw new Error(`drop shadow field ${label} not available`);
        }
        await field.fill(value);
        await field.press('Enter');
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'background-removal',
    requiresEnv: 'VARVE_SHOT_MODELS',
    file: 'background-removal-light.png',
    theme: 'light',
    feature: 'background-removal',
    alt: 'The Varve background removal inspector after generating a cutout mask on an imported photo, with the mask shown on a checkerboard and its algorithm score reported before applying',
    caption: 'Generate a cutout locally, review the mask on a checkerboard, then apply it.',
    async run(page) {
      await openCleanEditor(page);
      await importImage(page, 'earth.jpg');
      await selectImageNode(page);
      await fitContent(page);
      await openImageToolsTab(page);
      const section = await expandSection(page, /^Background Removal/);
      // Default is Fast, a local heuristic that applies straight away without
      // a review step. Auto runs IS-Net General Use — the real cutout model,
      // and the mode whose mask is worth reviewing before applying.
      const method = section.getByRole('combobox').first();
      await method.click();
      const auto = page.getByRole('option', { name: /auto/i }).first();
      if (!(await auto.isVisible({ timeout: 5000 }).catch(() => false))) {
        throw new Error('background removal method list has no Auto option');
      }
      await auto.click();
      await page.waitForTimeout(1500);
      const create = section.getByRole('button', {
        name: /remove background from image|re-apply background removal/i,
      });
      if (!(await create.isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new Error('background removal has no preview action for the selected image');
      }
      await create.click();
      // Inference runs in a worker; the review panel is the completion signal.
      const review = section.getByText(/review mask before applying/i);
      const result = await waitForInferenceResult(review, section, 900000);
      if (result !== 'success') {
        // Report what the panel actually says: "no preview appeared" is not
        // enough to tell a model failure from a changed label.
        const state = (await section.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, 240);
        const detail = typeof result === 'object' ? ` — error: ${result.error || 'unknown'}` : '';
        throw new Error(
          `background removal produced no mask preview to review${detail} — panel read: ${state}`,
        );
      }
      const reviewPanel = section.getByRole('region', { name: 'Background removal review' });
      await reviewPanel.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await expect(reviewPanel.getByAltText('Isolated subject preview')).toBeInViewport({
        ratio: 1,
      });
      await expect(reviewPanel.getByRole('button', { name: /apply/i })).toBeInViewport();
      await page.waitForTimeout(1200);
    },
  },
];
