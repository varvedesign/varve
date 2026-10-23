import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * axe-core scans on representative routes in both themes.
 *
 * An axe pass is not proof the visual result is correct (the computed-style
 * specs cover that), but it guards against structural a11y regressions:
 * landmarks, heading order, link names, ARIA misuse, color-only indicators
 * that axe can detect.
 *
 * Two viewports are scanned deliberately. Some violations only exist in a
 * width band where a component has to overflow: `.distro-picker` on /download
 * scrolls its table between roughly 600px and 900px and is reported by
 * `scrollable-region-focusable` there, while the 1280px desktop viewport sees a
 * table that fits and stays silent. The 2026-10-22 website audit found exactly
 * that: a serious violation the gate could not see.
 */

const SCANS = [
  { route: '/', name: 'home' },
  { route: '/download', name: 'download' },
  { route: '/docs', name: 'docs' },
  { route: '/docs/chromebook', name: 'chromebook-docs' },
  { route: '/docs/performance', name: 'performance-docs' },
  { route: '/docs/touch-and-pen', name: 'touch-and-pen-docs' },
  { route: '/docs/workspaces', name: 'workspaces' },
  { route: '/features', name: 'features' },
  { route: '/features/export', name: 'export-feature' },
  { route: '/docs/tools/export', name: 'export-docs' },
  { route: '/support/faq', name: 'faq' },
  { route: '/compare', name: 'compare' },
  { route: '/learn/examples', name: 'learn-examples' },
  // Trust surfaces. These carry the contact directory and the security
  // disclosure route, so an a11y regression here blocks someone from
  // reporting a vulnerability or asking for help.
  { route: '/contact', name: 'contact' },
  { route: '/support', name: 'support' },
  { route: '/security', name: 'security' },
  { route: '/press', name: 'press' },
  { route: '/about/privacy', name: 'privacy' },
  { route: '/accessibility', name: 'accessibility' },
  { route: '/404', name: '404' },
];

/**
 * Routes with a wide table or strip, re-scanned where it actually overflows.
 *
 * `/download` pins its platform with a fragment on purpose. The page
 * pre-selects a platform from the user agent, and the runner's Chromium reports
 * a Windows UA even on Linux, so a plain `/download` scan only ever exercises
 * the Windows panel — the distro table, which is the widest thing on the site,
 * would never be scanned. Both panels are covered explicitly.
 */
const NARROW_SCANS = [
  { route: '/', name: 'home' },
  { route: '/download#platform-linux', name: 'download-linux' },
  { route: '/download#platform-windows', name: 'download-windows' },
  { route: '/compare', name: 'compare' },
  { route: '/docs', name: 'docs' },
];

const THEMES = [
  { name: 'light', colorScheme: 'light' as const },
  { name: 'dark', colorScheme: 'dark' as const },
];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const relevant = results.violations.filter(
    (v) => !['region', 'landmark-one-main'].includes(v.id),
  );
  expect(
    relevant,
    JSON.stringify(
      relevant.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
      null,
      2,
    ),
  ).toEqual([]);
}

for (const scan of SCANS) {
  for (const t of THEMES) {
    test(`${scan.name} [${t.name}] has zero axe violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await page.goto(scan.route);
      await expectNoViolations(page);
    });
  }
}

test.describe('narrow viewport (768px)', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  for (const scan of NARROW_SCANS) {
    for (const t of THEMES) {
      test(`${scan.name} [${t.name}] has zero axe violations at 768px`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: t.colorScheme });
        await page.goto(scan.route);
        await expectNoViolations(page);
      });
    }
  }

  // The axe pass above only catches a regression while the distro table still
  // overflows in the running font environment. Pin the properties directly so a
  // font change or a manifest change cannot quietly retire the guard.
  test('the distro table keeps its scroll region contract', async ({ page }) => {
    // The table lives in the Linux panel, which is only active by default when
    // the UA says Linux; pin it so this does not depend on the runner's UA.
    await page.goto('/download#platform-linux');
    const picker = page.locator('.distro-picker');
    await expect(picker).toHaveAttribute('tabindex', '0');
    await expect(picker).toHaveAttribute('role', 'region');
    // Assert through the role engine: it resolves the name from `aria-label` the
    // same way assistive technology does (verified against the CDP accessibility
    // tree), which `toHaveAccessibleName` does not do for this role.
    await expect(page.getByRole('region', { name: 'Which package should I choose' })).toHaveCount(
      1,
    );
    expect(await picker.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});
