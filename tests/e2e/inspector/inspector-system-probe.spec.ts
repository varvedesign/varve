/**
 * Inspector system probe — measures the panel as a whole, not one control.
 *
 * Records what a user actually faces in the Design tab for each selection
 * family: how many sections render, how far the common ones sit from the top,
 * how much scrolling the panel demands at a real rail height, whether any
 * section is mounted twice, and how many interactive controls are in play.
 *
 * Evidence lands in the git-ignored `reports/inspector-system/` so repeated
 * runs never churn committed artifacts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT_DIR = path.resolve('reports/inspector-system');

interface SectionRow {
  id: string;
  title: string;
  expanded: boolean;
  top: number;
  height: number;
}

interface PanelDump {
  viewport: { width: number; height: number };
  rail: { width: number; height: number };
  scrollHeight: number;
  clientHeight: number;
  sectionCount: number;
  expandedCount: number;
  interactiveControls: number;
  duplicateSections: string[];
  sections: SectionRow[];
}

async function dumpPanel(page: Page): Promise<PanelDump> {
  return page.evaluate(() => {
    const panel = document.querySelector('.editor-inspector') as HTMLElement | null;
    if (!panel) throw new Error('inspector not mounted');
    const scroller =
      (panel.querySelector('.insp-panel') as HTMLElement | null) ?? (panel as HTMLElement);
    const scope = scroller.getBoundingClientRect();
    const sections = Array.from(scroller.querySelectorAll('section.insp-disclosure'));
    const rows = sections.map((section) => {
      const trigger = section.querySelector('.insp-disclosure__trigger');
      const rect = section.getBoundingClientRect();
      const subsection = section.getAttribute('data-subsection-id');
      const id = section.getAttribute('data-section-id') ?? '';
      return {
        id: subsection ? `${id}#${subsection}` : id,
        title: (trigger?.textContent ?? '').trim(),
        expanded: trigger?.getAttribute('aria-expanded') === 'true',
        top: Math.round(rect.top - scope.top),
        height: Math.round(rect.height),
      };
    });
    const ids = rows.map((row) => row.id).filter(Boolean);
    const duplicateSections = Array.from(new Set(ids.filter((id, i) => ids.indexOf(id) !== i)));

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rail: { width: Math.round(scope.width), height: Math.round(scope.height) },
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      sectionCount: rows.length,
      expandedCount: rows.filter((row) => row.expanded).length,
      interactiveControls: scroller.querySelectorAll(
        'button, input, select, textarea, [role="spinbutton"], [role="slider"], [role="switch"], [role="combobox"]',
      ).length,
      duplicateSections,
      sections: rows,
    };
  });
}

async function drawRect(page: Page, x: number, y: number, w: number, h: number) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.keyboard.press('v');
}

async function ensureDesignTab(page: Page) {
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Design' })).toBeVisible();
}

test.describe('Inspector system probe', () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test('records the Design tab shape for each selection family', async ({ page }) => {
    // A realistic desktop rail height, not a tall test viewport.
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const results: Record<string, PanelDump> = {};

    await ensureDesignTab(page);
    results.empty = await dumpPanel(page);

    await drawRect(page, 180, 180, 240, 160);
    await ensureDesignTab(page);
    results.shape = await dumpPanel(page);

    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');
    await page.mouse.click(canvasBox.x + 620, canvasBox.y + 260);
    await page.keyboard.type('Inspector probe');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await ensureDesignTab(page);
    results.text = await dumpPanel(page);

    // Multi-selection of two shapes.
    await drawRect(page, 200, 420, 160, 120);
    await drawRect(page, 420, 420, 160, 120);
    await page.keyboard.press('Control+a');
    await expect(page.getByRole('tabpanel', { name: 'Design' })).toBeVisible();
    results.multi = await dumpPanel(page);

    writeFileSync(path.join(OUT_DIR, 'design-tab-shape.json'), JSON.stringify(results, null, 2));
    writeFileSync(
      path.join(OUT_DIR, 'design-tab-shape.txt'),
      Object.entries(results)
        .map(([family, dump]) => {
          const header = `${family}: ${dump.sectionCount} sections (${dump.expandedCount} expanded), ${dump.interactiveControls} controls, scroll ${dump.scrollHeight}/${dump.clientHeight}, duplicates: ${dump.duplicateSections.join(', ') || 'none'}`;
          const rows = dump.sections
            .map(
              (row) =>
                `  ${row.expanded ? '[x]' : '[ ]'} ${row.top.toString().padStart(6)}px  ${String(row.height).padStart(5)}px  ${row.id} — ${row.title}`,
            )
            .join('\n');
          return `${header}\n${rows}`;
        })
        .join('\n\n'),
    );

    // Guard the probe itself: a shape selection must render a panel with
    // sections, otherwise the recorded numbers would be meaningless.
    expect(results.shape?.sectionCount ?? 0).toBeGreaterThan(0);
    expect(results.shape?.duplicateSections ?? []).toEqual([]);
  });

  test('records how the panel adapts to the supported rail widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page, 180, 180, 240, 160);
    await ensureDesignTab(page);

    const host = page.locator('.editor__inspector-panel');
    const widths = [240, 280, 320, 400, 640];
    const results: Record<string, PanelDump> = {};
    for (const width of widths) {
      await host.evaluate((element, nextWidth) => {
        const node = element as HTMLElement;
        node.style.width = `${nextWidth}px`;
        node.style.maxWidth = 'none';
        node.style.minWidth = '0';
        const parent = node.parentElement;
        if (parent) {
          parent.style.gridTemplateColumns = parent.style.gridTemplateColumns.replace(
            /[\d.]+px\s*$/,
            `${nextWidth}px`,
          );
        }
      }, width);
      await page.waitForTimeout(120);
      results[`${width}px`] = await dumpPanel(page);
    }

    writeFileSync(path.join(OUT_DIR, 'rail-widths.json'), JSON.stringify(results, null, 2));
    for (const [label, dump] of Object.entries(results)) {
      expect(dump.rail.width, `${label} rail width`).toBeGreaterThan(0);
    }
  });
});
