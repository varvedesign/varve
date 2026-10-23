import { expect, test } from '@playwright/test';
import { FIXTURES } from '../visual/fixtures';

for (const deviceScaleFactor of [1, 2, 3]) {
  test.describe(`gradient translation DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test('translating a gradient moves its artwork without shifting its local paint field', async ({
      page,
    }) => {
      const fixture = FIXTURES.find((candidate) => candidate.name === 'linear-gradient-rotated');
      if (!fixture) throw new Error('Missing canonical linear gradient fixture');
      await page.goto('/visual-harness.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => (window as unknown as { __harnessReady?: boolean }).__harnessReady === true,
      );

      const difference = await page.evaluate(async (fixture) => {
        const render = (
          window as unknown as {
            __renderFixture: (items: unknown[], width: number, height: number) => Promise<void>;
          }
        ).__renderFixture;
        const canvas = document.getElementById('harness-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No real Canvas2D context');
        const offset = 40;
        await render(fixture.items, fixture.width, fixture.height);
        const original = ctx.getImageData(0, 0, fixture.width, fixture.height).data;
        const shifted = fixture.items.map((item) => ({
          ...item,
          transform: item.transform.map((value, index) => (index === 4 ? value + offset : value)),
        }));
        await render(shifted, fixture.width + offset * 2, fixture.height);
        const translated = ctx.getImageData(offset, 0, fixture.width, fixture.height).data;
        let differentChannels = 0;
        let maxDelta = 0;
        for (let index = 0; index < original.length; index++) {
          const delta = Math.abs(original[index]! - translated[index]!);
          if (delta !== 0) differentChannels++;
          maxDelta = Math.max(maxDelta, delta);
        }
        return { differentChannels, maxDelta };
      }, fixture);

      // This independent relation must hold before a translated golden can be
      // accepted: moving a shape cannot shift the gradient inside that shape.
      expect(difference).toEqual({ differentChannels: 0, maxDelta: 0 });
      await page.locator('#harness-canvas').screenshot({
        path: test.info().outputPath('translated-gradient-oracle.png'),
      });
    });
  });
}
