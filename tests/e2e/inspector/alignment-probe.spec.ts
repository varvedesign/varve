/**
 * Inspector three-edge alignment probe (Route B: section templates).
 *
 * Two metrics, both recorded:
 *
 * 1. GLOBAL three lines (informational): every side-by-side `.insp-field`
 *    row measured against the panel's own modal label-left, control-left,
 *    and control-right lines. This is the strict-global view; designed
 *    compositions (two-up grids, field+action rows) deviate from it by
 *    construction, so it is reported but never gated.
 *
 * 2. SECTION-TEMPLATE conformity (the gate): rows are classified by
 *    template role — `single`, `paired-first`, `paired-second`,
 *    `field-action` — and each row's three edges are graded against the
 *    modal lines of its own (section, template-role) peers. A row fails
 *    only when it drifts from the column system its own peers establish,
 *    which is what catches regressions without punishing designed
 *    diversity (the position-size two-up grid and the corner-radius
 *    field+action row are legitimate templates).
 *
 * Stacked rows (control below the label) are excluded from both rates but
 * counted in the report so the denominator is visible. Tolerance 1px.
 *
 * Evidence lands in `reports/inspector-alignment/`. The probe guards only
 * that a meaningful sample was measured; thresholds belong to the repair
 * work that consumes the report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { resizePanelToWidth } from '../helpers/panel-resize';
import { navigateToEditor } from '../shared';

const OUT_DIR = path.resolve('reports/inspector-alignment');
const RAILS = [320, 640] as const;
const TOLERANCE_PX = 1;

type TemplateRole = 'single' | 'paired-first' | 'paired-second' | 'field-action';

interface RawRow {
  section: string;
  label: string;
  template: TemplateRole;
  labelLeft: number;
  controlLeft: number;
  controlRight: number;
  inline: boolean;
}

interface Edges {
  left: boolean;
  middle: boolean;
  right: boolean;
}

interface FieldRow {
  section: string;
  label: string;
  template: TemplateRole;
  layout: 'inline' | 'stacked';
  labelLeft: number;
  controlLeft: number;
  controlRight: number;
  sectionMatch: Edges;
  globalMatch: Edges;
  pass: boolean;
  globalConform: boolean;
}

interface RailSample {
  inlineRows: number;
  stackedRows: number;
  pass: number;
  passRate: number;
  globalRate: number;
  templateCounts: Record<string, number>;
  sectionRefs: Record<string, { labelLeft: number; controlLeft: number; controlRight: number }>;
  globalRefs: { labelLeft: number; controlLeft: number; controlRight: number };
  rows: FieldRow[];
}

type Sample = Record<string, RailSample>;

function modeBucket(values: number[]): number {
  const buckets = new Map<number, number>();
  for (const value of values) {
    const bucket = Math.round(value);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [bucket, count] of buckets) {
    if (count > bestCount || (count === bestCount && bucket < best)) {
      best = bucket;
      bestCount = count;
    }
  }
  return best;
}

async function expandAllSections(page: Page): Promise<void> {
  const triggers = page.locator(
    '.insp-panel button.insp-disclosure__trigger[aria-expanded="false"]',
  );
  for (let guard = 0; guard < 40; guard += 1) {
    const trigger = triggers.first();
    if ((await trigger.count()) === 0) break;
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.waitForTimeout(80);
  }
  // Scroll the panel through its full height so any lazily-rendered rows
  // exist before the geometry dump, then return to the top.
  await page.evaluate(() => {
    const scroller = document.querySelector('.insp-panel');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const scroller = document.querySelector('.insp-panel');
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(120);
}

async function drawRect(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
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

async function selectText(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  // Click inside the canvas regardless of how wide the side rails are; a
  // fixed x lands in the Inspector once the rail grows to 640px.
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
  await page.keyboard.type('Alignment probe');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

async function ensureDesignTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Design' })).toBeVisible();
}

async function dumpRawRows(page: Page): Promise<RawRow[]> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.insp-panel');
    if (!scroller) throw new Error('inspector scroller not mounted');
    const rows: RawRow[] = [];
    for (const field of scroller.querySelectorAll('.insp-field')) {
      const label = field.querySelector('.insp-field__label');
      const control = field.querySelector('.insp-field__control');
      if (!label || !control) continue;
      const section = field.closest('section.insp-disclosure');
      const labelRect = label.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      if (labelRect.height === 0 || controlRect.height === 0) continue;
      const inline = controlRect.top < labelRect.bottom - 1;

      // Template classification from DOM structure: a peer `.insp-field`
      // sharing this row line means a two-up pair; a trailing button
      // sibling means a field+action composition.
      let template: RawRow['template'] = 'single';
      const parent = field.parentElement;
      if (parent) {
        const peers = Array.from(parent.querySelectorAll(':scope > .insp-field')).filter((peer) => {
          const peerControl = peer.querySelector('.insp-field__control');
          if (!peerControl) return false;
          const peerRect = peerControl.getBoundingClientRect();
          return peerRect.height > 0 && Math.abs(peerRect.top - controlRect.top) <= 4;
        });
        if (peers.length > 1) {
          const firstByX = peers
            .map(
              (peer) => peer.querySelector('.insp-field__label')?.getBoundingClientRect().left ?? 0,
            )
            .sort((a, b) => a - b);
          const ownLeft = labelRect.left;
          template =
            Math.abs(ownLeft - (firstByX[0] ?? ownLeft)) <= 1 ? 'paired-first' : 'paired-second';
        } else if (parent.querySelector(':scope > button')) {
          template = 'field-action';
        }
      }

      rows.push({
        section: section?.getAttribute('data-section-id') ?? '(unknown)',
        label: (label.textContent ?? '').trim(),
        template,
        labelLeft: labelRect.left,
        controlLeft: controlRect.left,
        controlRight: controlRect.right,
        inline,
      });
    }
    return rows;
  });
}

function gradeRows(raw: RawRow[]): RailSample {
  const inline = raw.filter((row) => row.inline);
  const globalRefs = {
    labelLeft: modeBucket(inline.map((row) => row.labelLeft)),
    controlLeft: modeBucket(inline.map((row) => row.controlLeft)),
    controlRight: modeBucket(inline.map((row) => row.controlRight)),
  };
  const within = (value: number, ref: number) => Math.abs(value - ref) <= TOLERANCE_PX + 0.5;

  // Per (section, template-role) peer groups carry their own modal lines.
  const groups = new Map<string, RawRow[]>();
  for (const row of inline) {
    const key = `${row.section}::${row.template}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const groupRefs = new Map<
    string,
    { labelLeft: number; controlLeft: number; controlRight: number }
  >();
  for (const [key, group] of groups) {
    groupRefs.set(key, {
      labelLeft: modeBucket(group.map((row) => row.labelLeft)),
      controlLeft: modeBucket(group.map((row) => row.controlLeft)),
      controlRight: modeBucket(group.map((row) => row.controlRight)),
    });
  }

  const rows: FieldRow[] = raw.map((row) => {
    if (!row.inline) {
      return {
        section: row.section,
        label: row.label,
        template: row.template,
        layout: 'stacked',
        labelLeft: Math.round(row.labelLeft),
        controlLeft: Math.round(row.controlLeft),
        controlRight: Math.round(row.controlRight),
        sectionMatch: { left: false, middle: false, right: false },
        globalMatch: { left: false, middle: false, right: false },
        pass: false,
        globalConform: false,
      };
    }
    const refs = groupRefs.get(`${row.section}::${row.template}`) ?? globalRefs;
    const sectionMatch = {
      left: within(row.labelLeft, refs.labelLeft),
      middle: within(row.controlLeft, refs.controlLeft),
      right: within(row.controlRight, refs.controlRight),
    };
    const globalMatch = {
      left: within(row.labelLeft, globalRefs.labelLeft),
      middle: within(row.controlLeft, globalRefs.controlLeft),
      right: within(row.controlRight, globalRefs.controlRight),
    };
    return {
      section: row.section,
      label: row.label,
      template: row.template,
      layout: 'inline',
      labelLeft: Math.round(row.labelLeft),
      controlLeft: Math.round(row.controlLeft),
      controlRight: Math.round(row.controlRight),
      sectionMatch,
      globalMatch,
      pass: sectionMatch.left && sectionMatch.middle && sectionMatch.right,
      globalConform: globalMatch.left && globalMatch.middle && globalMatch.right,
    };
  });

  const inlineGraded = rows.filter((row) => row.layout === 'inline');
  const pass = inlineGraded.filter((row) => row.pass).length;
  const globalConform = inlineGraded.filter((row) => row.globalConform).length;
  const templateCounts: Record<string, number> = {};
  for (const row of inlineGraded) {
    templateCounts[row.template] = (templateCounts[row.template] ?? 0) + 1;
  }
  const sectionRefs: RailSample['sectionRefs'] = {};
  for (const [key, refs] of groupRefs) {
    sectionRefs[key] = {
      labelLeft: Math.round(refs.labelLeft),
      controlLeft: Math.round(refs.controlLeft),
      controlRight: Math.round(refs.controlRight),
    };
  }
  return {
    inlineRows: inlineGraded.length,
    stackedRows: raw.length - inlineGraded.length,
    pass,
    passRate: inlineGraded.length === 0 ? 0 : pass / inlineGraded.length,
    globalRate: inlineGraded.length === 0 ? 0 : globalConform / inlineGraded.length,
    templateCounts,
    sectionRefs,
    globalRefs: {
      labelLeft: Math.round(globalRefs.labelLeft),
      controlLeft: Math.round(globalRefs.controlLeft),
      controlRight: Math.round(globalRefs.controlRight),
    },
    rows,
  };
}

async function measureFamily(page: Page, family: 'shape' | 'text'): Promise<RailSample> {
  if (family === 'shape') {
    await drawRect(page, 180, 180, 240, 160);
  } else {
    await page.keyboard.press('Escape');
    await selectText(page);
  }
  await ensureDesignTab(page);
  await expandAllSections(page);
  return gradeRows(await dumpRawRows(page));
}

function formatSample(key: string, sample: RailSample): string {
  const templates = Object.entries(sample.templateCounts)
    .map(([role, count]) => `${role}=${count}`)
    .join(' ');
  const failing = sample.rows
    .filter((row) => row.layout === 'inline' && !row.pass)
    .map((row) => {
      const missed = Object.entries(row.sectionMatch)
        .filter(([, ok]) => !ok)
        .map(([edge]) => edge)
        .join(',');
      return `    ${row.section}::${row.template} "${row.label}" L=${row.labelLeft} M=${row.controlLeft} R=${row.controlRight} [${missed}]`;
    })
    .join('\n');
  return [
    `${key}: section-template ${sample.pass}/${sample.inlineRows} = ${(sample.passRate * 100).toFixed(1)}%; global-three-line ${(sample.globalRate * 100).toFixed(1)}% (stacked excluded: ${sample.stackedRows})`,
    `  templates: ${templates}`,
    `  global refs L/M/R=${sample.globalRefs.labelLeft}/${sample.globalRefs.controlLeft}/${sample.globalRefs.controlRight}`,
    failing || '  all rows conform to their (section, template) peers',
  ].join('\n');
}

test.describe('Inspector three-edge alignment probe', () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test('measures three-edge conformity for shape and text selections', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const results: Sample = {};
    for (const rail of RAILS) {
      // Geometry depends on the rail, so re-dump at each width.
      await resizePanelToWidth(page, 'inspector', rail);
      results[`shape@${rail}`] = await measureFamily(page, 'shape');
      results[`text@${rail}`] = await measureFamily(page, 'text');
    }

    writeFileSync(path.join(OUT_DIR, 'alignment.json'), JSON.stringify(results, null, 2));
    writeFileSync(
      path.join(OUT_DIR, 'alignment.txt'),
      `${Object.entries(results)
        .map(([key, sample]) => formatSample(key, sample))
        .join('\n\n')}\n`,
    );

    // Guard the probe itself: a healthy sample exists, otherwise the rates
    // would be meaningless. Shape selections expose fewer `.insp-field` rows
    // than text (paint/stroke rows are not `.insp-field`), so the floors differ.
    expect(results['shape@320']?.inlineRows ?? 0, 'shape sample at 320').toBeGreaterThan(5);
    expect(results['text@320']?.inlineRows ?? 0, 'text sample at 320').toBeGreaterThan(10);
    expect(results['shape@640']?.inlineRows ?? 0, 'shape sample at 640').toBeGreaterThan(5);
    expect(results['text@640']?.inlineRows ?? 0, 'text sample at 640').toBeGreaterThan(10);
  });
});
