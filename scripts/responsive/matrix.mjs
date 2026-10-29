/**
 * Viewport matrix, route table, screenshot naming, and the report.md renderer
 * for the responsive validation harness.
 *
 * scripts/responsive/capture.mjs drives Playwright with these entries and
 * scripts/validate-responsive.mjs writes report.json/report.md. The required
 * editor sizes are asserted at startup so a future edit cannot silently drop a
 * device class from the coverage.
 */

/** Editor viewports, grouped by device class. */
export const EDITOR_VIEWPORTS = [
  // Phones: portrait, 320 is the WCAG 1.4.10 reflow floor.
  { label: 'phone-320x640', width: 320, height: 640, tier: 'phone' },
  { label: 'phone-375x667', width: 375, height: 667, tier: 'phone' },
  { label: 'phone-390x844', width: 390, height: 844, tier: 'phone' },
  // Tablets: portrait then landscape, including the 13-inch 4:3 class.
  { label: 'tablet-768x1024', width: 768, height: 1024, tier: 'tablet' },
  { label: 'tablet-820x1180', width: 820, height: 1180, tier: 'tablet' },
  { label: 'tablet-1024x768', width: 1024, height: 768, tier: 'tablet' },
  { label: 'tablet-1024x1366', width: 1024, height: 1366, tier: 'tablet' },
  // 13-inch desktop window contract: default size and 125% Windows scaling.
  { label: '13in-125pct-scaling-1093x614', width: 1093, height: 614, tier: 'laptop' },
  { label: '13in-window-default-1180x720', width: 1180, height: 720, tier: 'laptop' },
  { label: 'tablet-1180x820', width: 1180, height: 820, tier: 'tablet' },
  { label: 'tablet-1366x1024', width: 1366, height: 1024, tier: 'tablet' },
  // 13-14 inch laptops at 100% scaling plus the 1536 desktop edge.
  { label: 'laptop-1280x800', width: 1280, height: 800, tier: 'laptop' },
  { label: 'laptop-1366x768', width: 1366, height: 768, tier: 'laptop' },
  { label: 'laptop-1440x900', width: 1440, height: 900, tier: 'laptop' },
  { label: 'laptop-1512x982', width: 1512, height: 982, tier: 'laptop' },
  { label: 'desktop-1536x864', width: 1536, height: 864, tier: 'desktop' },
];

/** Every editor size the harness must cover, as width x height. */
export const REQUIRED_EDITOR_SIZES = [
  '320x640',
  '375x667',
  '390x844',
  '768x1024',
  '820x1180',
  '1024x768',
  '1024x1366',
  '1093x614',
  '1180x720',
  '1180x820',
  '1280x800',
  '1366x768',
  '1366x1024',
  '1440x900',
  '1512x982',
  '1536x864',
];

/** Website viewports: phones, tablet portrait, laptop. */
export const WEBSITE_VIEWPORTS = [
  { label: 'phone-320x800', width: 320, height: 800 },
  { label: 'phone-375x800', width: 375, height: 800 },
  { label: 'tablet-768x900', width: 768, height: 900 },
  { label: 'laptop-1366x900', width: 1366, height: 900 },
];

/** Website routes that must reflow without page-level horizontal overflow. */
export const WEBSITE_ROUTES = [
  { route: '/', slug: 'home', label: 'Home' },
  { route: '/product', slug: 'product', label: 'Product' },
  { route: '/download', slug: 'download', label: 'Download' },
  { route: '/about/license', slug: 'about-license', label: 'About: License' },
  { route: '/docs/performance', slug: 'docs-performance', label: 'Docs: Performance' },
];

/** Return the "width x height" key used in filenames and reports. */
export function viewportKey(viewport) {
  return viewport.width + 'x' + viewport.height;
}

/** Screenshot path (relative to the output dir) for an editor capture. */
export function editorScreenshotName(viewport, state = 'default') {
  return 'editor/' + viewport.label + '-' + state + '.png';
}

/** Screenshot path (relative to the output dir) for a website capture. */
export function websiteScreenshotName(viewport, route) {
  return 'website/' + route.slug + '-' + viewportKey(viewport) + '.png';
}

/** Coverage self-check: required editor sizes missing from the matrix. */
export function missingEditorSizes(viewports = EDITOR_VIEWPORTS) {
  const present = new Set(viewports.map(viewportKey));
  return REQUIRED_EDITOR_SIZES.filter((size) => !present.has(size));
}
/** Human-readable report.md body derived from the report rows above. */
export function renderMarkdownReport(report, outDirLabel) {
  const failed = new Set(
    report.failures.map(
      (failure) => failure.app + '|' + failure.viewport + '|' + (failure.route || ''),
    ),
  );
  const pass = (app, viewport, route) => !failed.has(app + '|' + viewport + '|' + (route || ''));
  const lines = [
    '# Responsive validation report',
    '',
    '- Commit: ' + report.gitSha,
    '- Generated: ' + report.generatedAt,
    '- Command: ' + report.command,
    '- Result: ' +
      report.summary.result +
      ' (' +
      report.summary.passed +
      '/' +
      report.summary.total +
      ' checks)',
    '- Screenshots: ' +
      report.summary.screenshotCount +
      ' PNGs (' +
      report.summary.screenshotBytes +
      ' bytes)',
    '- Output: ' + outDirLabel,
    '',
  ];
  if (report.fatalError) lines.push('Fatal: ' + report.fatalError, '');
  if (report.editor) {
    lines.push(
      '## Editor',
      '',
      '| Viewport | Result | doc scrollWidth / innerWidth | Share right | Pills | Screenshot |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const row of report.editor.rows) {
      lines.push(
        '| ' +
          [
            row.label,
            pass('editor', row.label) ? 'PASS' : 'FAIL',
            row.doc.scrollWidth + ' / ' + row.viewport.width,
            row.share?.rect ? row.share.rect.right : 'n/a',
            row.pills.reachable + '/' + row.pills.count,
            row.screenshot || '(disabled)',
          ].join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  if (report.website) {
    lines.push(
      '## Website',
      '',
      '| Route | Viewport | Result | doc scrollWidth / innerWidth | Screenshot |',
    );
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of report.website.rows) {
      lines.push(
        '| ' +
          [
            row.route,
            row.label,
            pass('website', row.label, row.route) ? 'PASS' : 'FAIL',
            row.doc.scrollWidth + ' / ' + row.viewport.width,
            row.screenshot || '(disabled)',
          ].join(' | ') +
          ' |',
      );
    }
    lines.push('');
  }
  lines.push('## Failures', '');
  if (report.failures.length === 0) lines.push('None.');
  for (const failure of report.failures) {
    const where =
      failure.app + ' / ' + failure.viewport + (failure.route ? ' ' + failure.route : '');
    lines.push(
      '- ' +
        where +
        ' / ' +
        failure.id +
        ': expected ' +
        failure.expected +
        '; measured ' +
        JSON.stringify(failure.measured),
    );
  }
  lines.push('', '## Notes', '');
  lines.push(
    '- .editor-status and .editor-menubar__left may scroll internally; measured, not asserted.',
  );
  lines.push('- Editor screenshots are viewport-sized; website screenshots are full page.');
  return lines.join('\n');
}
