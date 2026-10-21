import { expect, test } from '@playwright/test';
import { exportIrToHtml } from '../../../packages/codegen/src/html';
import type { IRDocument, SemanticNode } from '../../../packages/codegen/src/ir-types';

test('generated grid CSS resolves across narrow, tablet, and desktop viewport widths', async ({
  page,
}, info) => {
  const emptyAppearance: SemanticNode['appearance'] = {
    background: [],
    foreground: [],
    strokes: [],
    border: {
      top: { width: 0, style: 'none', color: 'transparent' },
      right: { width: 0, style: 'none', color: 'transparent' },
      bottom: { width: 0, style: 'none', color: 'transparent' },
      left: { width: 0, style: 'none', color: 'transparent' },
      uniform: true,
    },
    typography: {
      fontFamily: 'sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
    },
    effects: [],
    transform: {
      translate: { x: 0, y: 0 },
      rotate: 0,
      scale: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
    },
    opacity: 1,
    blendMode: 'normal',
    borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    interactions: {},
  };
  const baseLayout = {
    direction: 'row' as const,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    gap: { top: 0, right: 0, bottom: 0, left: 0 },
    alignItems: 'start' as const,
    justifyContent: 'start' as const,
    width: { mode: 'fill' as const, value: 0 },
    height: { mode: 'hug' as const, value: 0 },
    responsive: { breakpoints: [] },
    overflow: { x: 'visible' as const, y: 'visible' as const },
  };
  const card = (id: string, name: string, column: number, background: string): SemanticNode => ({
    id,
    kind: 'card',
    name,
    role: { primary: 'card', inferred: false, confidence: 1 },
    accessibility: {},
    layout: {
      ...baseLayout,
      mode: 'none',
      height: { mode: 'fixed', value: 100 },
      gridPlacement: { column, row: 1, columnSpan: 1, rowSpan: 1 },
    },
    constraints: { horizontal: 'fixed', vertical: 'fixed' },
    appearance: {
      ...emptyAppearance,
      background: [{ type: 'solid', value: background, opacity: 1 }],
      borderRadius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
    },
    tokens: {},
    content: { type: 'text', text: { value: name } },
    children: [],
    metadata: { sourceNodeId: id, exportId: id, tags: [] },
    visible: true,
    locked: false,
  });
  const firstCard = card('primary-card', 'Primary Metric', 1, '#cdeee5');
  const secondCard = card('secondary-card', 'Secondary Metric', 2, '#dbeafe');
  const dashboard: SemanticNode = {
    ...card('dashboard', 'Responsive Dashboard', 1, '#f1f5f9'),
    layout: {
      ...baseLayout,
      mode: 'grid',
      gridTemplateColumns: '1fr 2fr',
      gap: { top: 12, right: 16, bottom: 12, left: 16 },
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    },
    children: [firstCard, secondCard],
  };
  const ir = {
    version: '2.1',
    metadata: {
      documentId: 'responsive-grid',
      name: 'Responsive grid export',
      generatedAt: 0,
      generatorVersion: 'test',
      sourceFormat: 'strata',
    },
    nodes: { [dashboard.id]: dashboard, [firstCard.id]: firstCard, [secondCard.id]: secondCard },
    rootIds: [dashboard.id],
    tokens: { colors: {}, spacing: {}, typography: {}, effects: {}, radii: {} },
    breakpoints: [],
    components: { components: {} },
    unsupportedFeatures: [],
    fidelityWarnings: [],
    htmlHints: {},
  } as unknown as IRDocument;
  const output = exportIrToHtml(ir);
  const html = output.html.replace(
    '<link rel="stylesheet" href="styles.css" />',
    `<style>${output.css}</style>`,
  );

  await page.setContent(html);
  const grid = page.locator('.responsive-dashboard');
  await expect(grid).toBeVisible();

  for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await grid.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const trackSizes = getComputedStyle(element)
        .gridTemplateColumns.split(' ')
        .map((size) => Number.parseFloat(size));
      const children = [...element.children].map((child) => child.getBoundingClientRect());
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        gridWidth: rect.width,
        trackSizes,
        childBounds: children.map(({ left, right, width: childWidth }) => ({
          left,
          right,
          width: childWidth,
        })),
      };
    });

    expect(metrics.gridWidth).toBeCloseTo(width, 0);
    expect(metrics.documentWidth).toBe(metrics.viewportWidth);
    expect(metrics.trackSizes).toHaveLength(2);
    expect(metrics.trackSizes[1]! / metrics.trackSizes[0]!).toBeCloseTo(2, 1);
    expect(metrics.childBounds).toHaveLength(2);
    expect(metrics.childBounds[0]!.left).toBeLessThan(metrics.childBounds[1]!.left);
    expect(metrics.childBounds[1]!.right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`responsive-grid-${width}.png`) });
  }
});
