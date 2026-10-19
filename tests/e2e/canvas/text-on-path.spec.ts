import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

/**
 * Text on path, end to end through the real editor.
 *
 * The engine has placed glyphs along a shape for a long time, but no editor
 * surface ever set `textMode: 'path'`, so the capability was unreachable.
 * These cover the route a user now takes: draw a shape, add text, attach.
 */

async function canvasBox(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 20000 });
  const box = await canvas.boundingBox();
  if (!box || box.width < 10) throw new Error('content canvas not laid out');
  return box;
}

async function dragOn(
  page: import('@playwright/test').Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function editSelectedText(page: import('@playwright/test').Page, value: string) {
  const editor = page.getByRole('textbox', { name: /editing text/i });
  if (!(await editor.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
  if (!(await editor.isVisible({ timeout: 800 }).catch(() => false))) {
    const edit = page.getByRole('button', { name: /^Edit$/ }).last();
    await edit.waitFor({ state: 'visible', timeout: 5000 });
    await edit.click();
    await editor.waitFor({ state: 'visible', timeout: 8000 });
  }
  await editor.fill(value);
  await expect(editor).toHaveValue(value);
  await editor.press('Escape');
  await page.waitForTimeout(350);
}

async function serializeEditorDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('React root not found');
    const key = Object.keys(root).find(
      (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
    );
    if (!key) throw new Error('React fiber not found');
    interface EditorLike {
      serializeDocument?: () => string;
    }
    interface FiberLike {
      memoizedProps?: { value?: EditorLike };
      child?: unknown;
      sibling?: unknown;
    }
    function find(fiber: unknown): EditorLike | null {
      if (!fiber || typeof fiber !== 'object') return null;
      const candidate = fiber as FiberLike;
      if (typeof candidate.memoizedProps?.value?.serializeDocument === 'function') {
        return candidate.memoizedProps.value;
      }
      return find(candidate.child) ?? find(candidate.sibling);
    }
    const editor = find((root as unknown as Record<string, unknown>)[key]);
    if (!editor?.serializeDocument) throw new Error('Missing editor context');
    return editor.serializeDocument();
  });
}

function textLayer(page: import('@playwright/test').Page) {
  return page
    .getByRole('treeitem')
    .filter({ hasText: /\bText:/i })
    .first();
}

/** Ellipse tool, then the text tool — the two nodes the attach needs. */
async function drawRingAndLabel(page: import('@playwright/test').Page) {
  await page.keyboard.press('o');
  await dragOn(page, 200, 150, 520, 470);
  await page.keyboard.press('t');
  await dragOn(page, 620, 200, 900, 250);
  await editSelectedText(page, 'VELO CLUB');
  await page.keyboard.press('v');
}

test.describe('text on path', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('the Object menu offers Text on Path once a text layer and a shape are selected', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    const item = page.getByRole('menuitem', { name: /^Text on Path$/ });
    await expect(item).toBeVisible({ timeout: 5000 });
    await expect(item).toBeEnabled();
  });

  test('attaching reveals the Text on Path inspector section', async ({ page }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);

    // The section only renders for a single text node already in path mode,
    // so its presence is evidence the document actually changed.
    await textLayer(page).click();
    await expect(page.getByRole('slider', { name: /start offset along path/i })).toBeVisible({
      timeout: 8000,
    });
  });

  test('the attached text redraws when the start offset moves', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);
    await textLayer(page).click();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(500);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('text-on-path-before-offset.png') });
    const offset = page.getByRole('slider', { name: /start offset along path/i });
    await offset.fill('35');
    await expect(offset).toHaveValue('35');
    await page.waitForTimeout(700);

    const after = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('text-on-path-after-offset.png') });
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('the first drag moves a multi-selection containing text on path together', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);

    const before = JSON.parse(await serializeEditorDocument(page)) as {
      nodes: Record<
        string,
        {
          kind?: string;
          textMode?: string;
          pathTextSettings?: { pathNodeId?: string };
          transform?: number[];
        }
      >;
    };
    const textEntry = Object.entries(before.nodes).find(([, node]) => node.textMode === 'path');
    expect(textEntry, 'attached text node must be in path mode').toBeDefined();
    const [textId, textNode] = textEntry ?? ['', {}];
    const pathId = textNode.pathTextSettings?.pathNodeId;
    expect(pathId, 'path text must retain its referenced path').toBeTruthy();
    const pathNode = before.nodes[pathId ?? ''];
    expect(pathNode?.kind).toBe('shape');
    expect(textNode.transform).toHaveLength(6);
    expect(pathNode?.transform).toHaveLength(6);

    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(500);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.screenshot({ path: testInfo.outputPath('path-text-multiselect-before.png') });
    const box = await canvasBox(page);
    const centerX = box.width / 2;
    const centerY = box.height / 2;
    await dragOn(page, centerX - 35, centerY - 25, centerX + 35, centerY + 25);

    const after = JSON.parse(await serializeEditorDocument(page)) as typeof before;
    const movedText = after.nodes[textId];
    const movedPath = after.nodes[pathId ?? ''];
    expect(movedText?.transform).toHaveLength(6);
    expect(movedPath?.transform).toHaveLength(6);
    const textDelta = [
      (movedText?.transform?.[4] ?? 0) - (textNode.transform?.[4] ?? 0),
      (movedText?.transform?.[5] ?? 0) - (textNode.transform?.[5] ?? 0),
    ];
    const pathDelta = [
      (movedPath?.transform?.[4] ?? 0) - (pathNode?.transform?.[4] ?? 0),
      (movedPath?.transform?.[5] ?? 0) - (pathNode?.transform?.[5] ?? 0),
    ];
    expect(textDelta).not.toEqual([0, 0]);
    expect(pathDelta).toEqual(textDelta);
    await canvas.screenshot({
      path: testInfo.outputPath('path-text-multiselect-after-first-drag.png'),
    });
  });

  test('detaching removes the section and keeps the path', async ({ page }) => {
    test.setTimeout(120000);
    await drawRingAndLabel(page);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /^Object$/ }).click();
    await page.getByRole('menuitem', { name: /^Text on Path$/ }).click();
    await page.waitForTimeout(600);
    await textLayer(page).click();
    await expect(page.getByRole('slider', { name: /start offset along path/i })).toBeVisible();

    await page.getByRole('button', { name: /detach from path/i }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('slider', { name: /start offset along path/i })).toHaveCount(0);
    // The shape is an independent node and must survive the detach.
    await expect(page.getByRole('treeitem')).toHaveCount(2);
  });
});
