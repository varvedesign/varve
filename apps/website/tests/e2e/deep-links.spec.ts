import { expect, test } from '@playwright/test';

/**
 * Section deep links must reveal the panel that owns their target.
 *
 * The build indexes every `h2`/`h3` inside `<main>` (see
 * `scripts/search-index.mjs`), including headings that live inside a tab panel,
 * and `src/lib/search/rank.ts` links results as `page.url#section.anchor`. When
 * the target sits in an inactive panel it is `hidden`, so before the reveal
 * handlers existed the browser had no box to scroll to and the visitor landed on
 * an unchanged page — a search result that could not be reached.
 *
 * These assertions are deliberately about the outcome the visitor sees (the
 * heading is visible and clear of the sticky header), not about the handler.
 */
const CASES = [
  { route: '/#text-that-reads-like-a-book', heading: 'Text that reads like a book' },
  { route: '/#timelines-not-afterthoughts', heading: 'Timelines, not afterthoughts' },
  { route: '/#born-for-print-production', heading: 'Born for print production' },
  { route: '/download#macos', heading: 'macOS' },
  { route: '/download#windows', heading: 'Windows' },
];

// `html { scroll-behavior: smooth }` is enabled unless the visitor asks for
// reduced motion; pinning reduce makes the settled position deterministic.
test.use({ reducedMotion: 'reduce' });

for (const c of CASES) {
  test(`deep link reveals its panel: ${c.route}`, async ({ page }) => {
    await page.goto(c.route);

    const heading = page.getByRole('heading', { name: c.heading, exact: true }).first();
    await expect(heading).toBeVisible();

    // The owning panel must be revealed, not merely present in the DOM.
    const panelHidden = await heading.evaluate((el) => {
      const panel = el.closest<HTMLElement>('[role="tabpanel"]');
      return panel ? panel.hidden : null;
    });
    expect(panelHidden, 'owning tab panel must be shown').toBe(false);

    // And the heading must be clear of the sticky header (WCAG 2.4.11).
    await expect
      .poll(
        async () => {
          const box = await heading.boundingBox();
          const header = await page.locator('header.site-header').boundingBox();
          if (!box) return -1;
          const headerBottom = header ? header.y + header.height : 0;
          return Math.round(box.y - headerBottom);
        },
        { message: `${c.heading} should sit below the sticky header after the jump` },
      )
      .toBeGreaterThan(0);
  });
}

test('the tab that owns the deep-linked panel is the selected one', async ({ page }) => {
  await page.goto('/#text-that-reads-like-a-book');

  const selected = page.locator('[role="tab"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  const controls = await selected.getAttribute('aria-controls');
  expect(controls).toBeTruthy();

  const panel = page.locator(`#${controls}`);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Text that reads like a book' })).toBeVisible();
});
