import { expect, test } from '@playwright/test';
import { readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

const LOCKED_GRADIENT_FIXTURE = {
  id: 'locked-gradient-e2e-document',
  formatVersion: '2.0',
  name: 'Locked gradient handles',
  rootChildren: ['gradientShape'],
  nodes: {
    gradientShape: {
      id: 'gradientShape',
      kind: 'shape',
      name: 'Gradient Target',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 40, 120],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      fills: [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            transform: [120, 0, 0, 90, 60, 45],
            stops: [
              { position: 0, color: { space: 'rgb', r: 20, g: 80, b: 210, a: 255 } },
              { position: 1, color: { space: 'rgb', r: 230, g: 120, b: 40, a: 255 } },
            ],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      strokes: [],
      effects: [],
      shape: { kind: 'rect', x: 0, y: 0, w: 240, h: 180 },
    },
  },
  components: {},
  nextId: 2,
};

test('gradient handles hide on locked layers and reject a lock raised during drag', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page.locator('#file-open-input').setInputFiles({
    name: 'locked-gradient.strata',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(LOCKED_GRADIENT_FIXTURE)),
  });

  const layer = page.getByRole('treeitem', { name: /Gradient Target/ });
  await expect(layer).toBeVisible();
  await layer.click();
  const capture = async (name: string) => {
    const screenshot = await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
  };

  const overlay = page.locator('[data-gradient-handle-overlay]');
  const endHandle = page.locator('[data-gradient-handle="linear-end"]');
  await expect(overlay).toBeVisible();
  await expect(endHandle).toBeVisible();
  await capture('gradient-editable');

  const lockButton = () => page.getByRole('button', { name: /Lock Gradient Target/i });
  const unlockButton = () => page.getByRole('button', { name: /Unlock Gradient Target/i });
  await lockButton().click();
  await expect(overlay).toHaveCount(0);
  await capture('gradient-locked');

  await unlockButton().click();
  await expect(endHandle).toBeVisible();
  const handleBox = await endHandle.boundingBox();
  if (!handleBox) throw new Error('Gradient end handle has no rendered bounds');
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  const beforeUnlockedDrag = (await readEditorState(page)).serialized;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(overlay).toHaveAttribute('data-gradient-dragging', 'true');
  await page.mouse.move(start.x + 32, start.y + 18, { steps: 3 });
  await page.mouse.up();

  const afterUnlockedDrag = await endHandle.boundingBox();
  if (!afterUnlockedDrag) throw new Error('Gradient end handle disappeared after unlocked drag');
  expect({ x: afterUnlockedDrag.x, y: afterUnlockedDrag.y }).not.toEqual({
    x: handleBox.x,
    y: handleBox.y,
  });
  expect((await readEditorState(page)).serialized).not.toBe(beforeUnlockedDrag);
  await expect(endHandle).toBeVisible();
  await capture('gradient-edited-unlocked');

  const beforeLockedDrag = (await readEditorState(page)).serialized;
  const activeHandleBox = await endHandle.boundingBox();
  if (!activeHandleBox) throw new Error('Gradient end handle has no rendered bounds');
  const activeStart = {
    x: activeHandleBox.x + activeHandleBox.width / 2,
    y: activeHandleBox.y + activeHandleBox.height / 2,
  };
  await page.mouse.move(activeStart.x, activeStart.y);
  await page.mouse.down();
  await expect(overlay).toHaveAttribute('data-gradient-dragging', 'true');
  await page.mouse.move(activeStart.x + 12, activeStart.y + 8, { steps: 2 });
  const documentAtLock = (await readEditorState(page)).serialized;
  expect(documentAtLock).not.toBe(beforeLockedDrag);
  const gradientAtLock = JSON.stringify(
    JSON.parse(documentAtLock).nodes.gradientShape.fills[0].gradient,
  );

  // Use the real layer lock action while the canvas pointer is still held.
  // The active drag listener survives the hidden overlay render, so subsequent
  // real pointer moves exercise the callback's live-document lock check.
  await lockButton().evaluate((element) => (element as HTMLButtonElement).click());
  await expect(unlockButton()).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await capture('gradient-locked-during-drag');
  await page.mouse.move(activeStart.x + 56, activeStart.y + 42, { steps: 4 });
  await page.mouse.up();

  const afterLockedDrag = JSON.parse((await readEditorState(page)).serialized);
  expect(afterLockedDrag.nodes.gradientShape.locked).toBe(true);
  expect(JSON.stringify(afterLockedDrag.nodes.gradientShape.fills[0].gradient)).toBe(
    gradientAtLock,
  );
});
