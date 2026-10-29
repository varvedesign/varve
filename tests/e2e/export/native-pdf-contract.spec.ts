import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

type NativePdfPayload = {
  command: string;
  manifestJson: string;
  opts: { pageWidth: number; pageHeight: number };
  nodes: Array<{ fills?: unknown[]; shape?: { kind?: string } }>;
};

test('real embedded-artwork export sends decoded pixels across the native PDF boundary', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await navigateToCleanEditor(page);
  const fixturePath = path.resolve('tests/e2e/fixtures/published-v021/poster-embedded.varve');
  await page.setInputFiles('#file-open-input', fixturePath);
  await expect(page.locator('.editor-shell h1.sr-only')).toContainText('poster-embedded.varve');
  const image = page.getByRole('treeitem', { name: /^Published embedded image/ });
  if (!(await image.isVisible()))
    await page
      .getByRole('treeitem', { name: /^Poster — A3/ })
      .getByRole('button', { name: 'Expand', exact: true })
      .click();
  await image.click();
  const exportTab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible()) await exportTab.click();
  else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.getByRole('radio', { name: 'PDF', exact: true }).click();

  // This browser test qualifies the IPC argument boundary and real canvas
  // readback. Installed-platform qualification separately renders the actual
  // Rust-produced PDF; the deliberately inert response here is not that proof.
  await page.evaluate(() => {
    const win = window as unknown as {
      __TAURI__: unknown;
      __nativePdfPayload?: NativePdfPayload;
    };
    win.__TAURI__ = {
      core: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command !== 'export_node_pdf') throw new Error(`Unexpected native call ${command}`);
          if (typeof args.manifestJson !== 'string')
            throw new Error('Default native command requires camelCase manifestJson');
          win.__nativePdfPayload = { ...args, command } as NativePdfPayload;
          return [37, 80, 68, 70, 45, 49, 46, 52];
        },
      },
    };
  });
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __nativePdfPayload?: NativePdfPayload }).__nativePdfPayload
            ?.command,
      ),
    )
    .toBe('export_node_pdf');
  const payload = await page.evaluate(
    () => (window as unknown as { __nativePdfPayload: NativePdfPayload }).__nativePdfPayload,
  );
  writeFileSync(testInfo.outputPath('native-pdf-boundary.json'), `${JSON.stringify(payload)}\n`);
  expect([payload.opts.pageWidth, payload.opts.pageHeight]).toEqual([104, 80]);
  const manifest = JSON.parse(payload.manifestJson) as {
    images: { width: number; height: number; data: string; color_space: string }[];
  };
  expect(manifest.images).toHaveLength(1);
  const exported = manifest.images[0]!;
  expect([exported.width, exported.height, exported.color_space]).toEqual([104, 80, 'Rgb']);
  const pixels = Buffer.from(exported.data, 'base64');
  expect(pixels.length).toBe(104 * 80 * 4);
  const { PNG } = createRequire(path.resolve('packages/engine/package.json'))('pngjs');
  const original = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const source = PNG.sync.read(
    Buffer.from(original.assets['asset-ca2aceaaa125b46e'].dataUrl.split(',')[1], 'base64'),
  );
  for (const nx of [0.25, 0.75])
    for (const ny of [0.25, 0.75]) {
      const at = (Math.floor(ny * 80) * 104 + Math.floor(nx * 104)) * 4;
      const src =
        (Math.floor(ny * source.height) * source.width + Math.floor(nx * source.width)) * 4;
      expect(pixels.subarray(at, at + 4)).toEqual(source.data.subarray(src, src + 4));
    }
  writeFileSync(
    testInfo.outputPath('native-pdf-manifest.png'),
    PNG.sync.write({
      width: 104,
      height: 80,
      data: pixels,
    }),
  );
  await page.screenshot({ path: testInfo.outputPath('native-pdf-export-inspector.png') });
});

test('bold text with family-only font metadata is rasterized before native PDF export', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await navigateToCleanEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounds');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 180, box.y + 180);
  await page.keyboard.insertText('Missing Bold Face');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await page.keyboard.press('Control+a');
  const bold = page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', {
    name: 'Bold',
    exact: true,
  });
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select', exact: true }).click();

  const exportTab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await exportTab.isVisible()) await exportTab.click();
  else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.getByRole('radio', { name: 'PDF', exact: true }).click();

  await page.evaluate(() => {
    const win = window as unknown as {
      __TAURI__: unknown;
      __nativePdfPayload?: NativePdfPayload;
    };
    win.__TAURI__ = {
      core: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command !== 'export_node_pdf') throw new Error(`Unexpected native call ${command}`);
          if (typeof args.manifestJson !== 'string')
            throw new Error('Raster PDF fallback must send image manifest data');
          win.__nativePdfPayload = { ...args, command } as NativePdfPayload;
          return [37, 80, 68, 70, 45, 49, 46, 52];
        },
      },
    };
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const payload = await page.evaluate(
    () => (window as unknown as { __nativePdfPayload: NativePdfPayload }).__nativePdfPayload,
  );
  expect(payload.command).toBe('export_node_pdf');
  expect(payload.nodes).toHaveLength(1);
  expect(payload.nodes[0]).toMatchObject({ shape: { kind: 'rect' } });

  const manifest = JSON.parse(payload.manifestJson) as {
    images: { width: number; height: number; data: string; color_space: string }[];
  };
  expect(manifest.images).toHaveLength(1);
  const image = manifest.images[0]!;
  expect(image.width * image.height).toBeGreaterThan(0);
  const { PNG } = createRequire(path.resolve('packages/engine/package.json'))('pngjs');
  const rawPixels = Buffer.from(image.data, 'base64');
  expect(rawPixels).toHaveLength(image.width * image.height * 4);
  const pixels = { width: image.width, height: image.height, data: rawPixels };
  let nonTransparentPixels = 0;
  for (let index = 3; index < pixels.data.length; index += 4) {
    if (pixels.data[index] !== 0) nonTransparentPixels += 1;
  }
  expect(nonTransparentPixels).toBeGreaterThan(0);
  writeFileSync(testInfo.outputPath('native-pdf-bold-text-raster.png'), PNG.sync.write(pixels));
  await page.screenshot({ path: testInfo.outputPath('native-pdf-bold-text-export.png') });
});
