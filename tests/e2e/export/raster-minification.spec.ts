/**
 * E2E: a raster export must minify a placed image, not point-sample it.
 *
 * This is an outcome guard, not a test of one mechanism: minification happens
 * either in the at-size image decode (`resizeQuality: 'high'`) or in the
 * canvas sampling policy, and either is acceptable. What must not happen is a
 * nearest-neighbour result, which is what an 8x-downscaled 3px checkerboard
 * looks like: pure black and white pixels with the pattern still visible.
 *
 * A one-pixel checkerboard would *not* discriminate: measured in Chromium, the
 * cheap and high-quality canvas filters both average it to flat grey at 4:1.
 *
 * The test drives the real File > Import and Export tab, reads the downloaded
 * PNG, and asserts the image is neither pure black nor pure white.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Buffer };
      write(input: { width: number; height: number; data: Buffer }): Buffer;
    };
  };
};

/**
 * A 256x256 black/white checkerboard with 3px cells, drawn at 64px.
 *
 * The cell size is what makes this discriminating: at a 4:1 downscale a
 * one-pixel checker averages to flat grey under *both* canvas quality settings
 * (measured: identical output), while a 3px cell lands mid-pixel and the cheap
 * filter aliases to pure black and white. That is the regime that matters for
 * scanned text and fine linework.
 */
function checkerboardPng(): Buffer {
  const size = 256;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
      const offset = (y * size + x) * 4;
      const value = dark ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return PNG.sync.write({ width: size, height: size, data });
}

/** Update a node through the editor context, the same way a user's edit does. */
async function updateNode(
  page: import('@playwright/test').Page,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return page.evaluate(
    ({ nodeId, patch }) => {
      const root = document.getElementById('root');
      if (!root) return false;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return false;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'updateNode' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const update = context?.updateNode as
        | ((
            id: string,
            updater: (node: Record<string, unknown>) => Record<string, unknown>,
          ) => void)
        | undefined;
      if (typeof update !== 'function') return false;
      update(nodeId, (node) => ({ ...node, ...patch }));
      return true;
    },
    { nodeId, patch },
  );
}

/** The id of the most recently added image node, read from the layer tree. */
async function imageNodeId(page: import('@playwright/test').Page): Promise<string | null> {
  const row = page.locator('.layers-panel [role="treeitem"][data-node-id]').last();
  return row.getAttribute('data-node-id');
}

test.describe('raster export minification', () => {
  test('an 8x-downscaled checkerboard exports as an averaged grey, not pure pixels', async ({
    page,
  }) => {
    await navigateToEditor(page);

    const directory = mkdtempSync(join(tmpdir(), 'varve-minify-'));
    const source = join(directory, 'checker.png');
    writeFileSync(source, checkerboardPng());

    await page.getByRole('menubar').getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /import/i }).click();
    await page.locator('#file-import-input').setInputFiles(source);

    const layers = page.locator('.layers-panel');
    await expect(layers.getByText('checker.png')).toBeVisible({ timeout: 30000 });

    const id = await imageNodeId(page);
    expect(id).toBeTruthy();
    // 256 source pixels drawn at 64: a 4:1 minification.
    expect(await updateNode(page, id!, { transform: [0.25, 0, 0, 0.25, 100, 100] })).toBe(true);

    // Select the node so the Export tab targets it.
    await page.keyboard.press('v');
    await page.locator('.layers-panel [role="treeitem"]').first().click();

    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    if (await exportTab.isVisible().catch(() => false)) {
      await exportTab.click();
    } else {
      await page.getByRole('button', { name: /^More inspector tabs/ }).click();
      await page
        .getByRole('menu', { name: 'More inspector tabs' })
        .getByRole('menuitem', { name: 'Export', exact: true })
        .click();
    }
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    // 1x keeps the output at the node's own size (64px), so the fixture is
    // measured at the ratio it was designed for.
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: '1x', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = requireFromEngine('node:fs') as typeof import('node:fs');
    const png = PNG.sync.read(fs.readFileSync(path!));

    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    let min = 255;
    let max = 0;
    let samples = 0;
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const value = png.data[offset] ?? 0;
      if ((png.data[offset + 3] ?? 0) === 0) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
      samples += 1;
    }
    expect(samples).toBeGreaterThan(0);
    // Nearest-neighbour sampling of a black/white checkerboard leaves 0 and
    // 255 in the output; an area filter produces intermediate values.
    // Measured in Chromium at this ratio: the cheap filter aliases the 3px
    // pattern to pure black and white (0..255), the high-quality filter keeps
    // every sample inside 95..159.
    expect(min).toBeGreaterThan(40);
    expect(max).toBeLessThan(215);
  });
});
