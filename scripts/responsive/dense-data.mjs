#!/usr/bin/env node
/**
 * Dense-data responsive probe: re-runnable evidence for tasks 03a/03b.
 *
 * Seeds two vector layers and one timeline track through the real UI, then
 * measures the timeline row/label/transport targets and the layers row actions
 * at the docked 13-14in presentations (1180x820, 1366x1024) plus the compact
 * 1024 drawer presentation, fine and coarse pointer. Writes report.json /
 * report.md and optional PNGs to docs/responsive/screenshots/<sha>/dense/.
 *
 * Usage:
 *   XDG_RUNTIME_DIR=/tmp node scripts/quality/heavy-lease.mjs "validate:dense" -- \
 *     node scripts/responsive/dense-data.mjs
 *   node scripts/responsive/dense-data.mjs [--out DIR] [--no-screenshots]
 *     [--editor-url URL]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './capture.mjs';
import { assertDenseRun } from './dense/assert.mjs';
import { COARSE_RUNS, DENSE_SCREENSHOT_ROOT, FINE_RUNS, shortSha } from './dense/config.mjs';
import { measureLayers, measureTimeline } from './dense/measure.mjs';
import { writeReport } from './dense/report.mjs';
import {
  buildDenseScene,
  closeLayersDrawer,
  ensureLayersOpen,
  navigateToEditor,
} from './dense/scene.mjs';
import { ensureEditor, ROOT, stopChildren } from './server.mjs';

const USAGE = [
  'Usage: node scripts/responsive/dense-data.mjs [options]',
  '',
  '  --out <dir>        Output dir (default: docs/responsive/screenshots/<sha>/dense)',
  '  --no-screenshots   Assertions only, no PNGs',
  '  --editor-url <url> Reuse a running editor (default: http://localhost:1420)',
  '  -h, --help         Show this help',
].join('\n');

function parseArgs(argv) {
  const options = { out: null, screenshots: true, editorUrl: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--no-screenshots') options.screenshots = false;
    else if (flag === '-h' || flag === '--help') options.help = true;
    else if (flag === '--out' || flag === '--editor-url') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(flag + ' needs a value');
      index += 1;
      if (flag === '--out') options.out = value;
      else options.editorUrl = value.replace(/\/+$/, '');
    } else throw new Error('unknown argument: ' + flag);
  }
  return options;
}

function relativeToRoot(target) {
  return path.relative(ROOT, target).split(path.sep).join('/');
}

/** Measure one viewport: timeline first (drawer closed), then the layers panel. */
async function captureRun(page, run, settings) {
  await page.setViewportSize({ width: run.width, height: run.height });
  await page.waitForTimeout(1200);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  const timeline = await measureTimeline(page);
  const screenshots = [];
  if (settings.screenshots) {
    const file = path.join(settings.outDir, 'dense-' + run.label + '.png');
    await page.screenshot({ path: file, animations: 'disabled' });
    screenshots.push(relativeToRoot(file));
  }
  const steps = { openLayers: await ensureLayersOpen(page) };
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  const layersRest = await measureLayers(page);
  await page
    .locator('.layers-row')
    .filter({ has: page.locator('.layers-row__disclosure') })
    .first()
    .hover()
    .catch(() => {});
  await page.waitForTimeout(400);
  const layersHover = await measureLayers(page);
  if (settings.screenshots) {
    const file = path.join(settings.outDir, 'dense-' + run.label + '-layers.png');
    await page.screenshot({ path: file, animations: 'disabled' });
    screenshots.push(relativeToRoot(file));
  }
  steps.closeLayers = await closeLayersDrawer(page);
  await page.waitForTimeout(400);
  return { timeline, layersRest, layersHover, steps, screenshots };
}

/** One page resized through the fine-pointer matrix; the scene is seeded once. */
async function runFineSeries(browser, url, settings) {
  const first = FINE_RUNS[0];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('fine pageerror: ' + error.message));
  const records = [];
  let scene = null;
  try {
    await navigateToEditor(page, url);
    scene = await buildDenseScene(page);
    for (const run of FINE_RUNS) {
      records.push({ run, record: await captureRun(page, run, settings) });
    }
  } finally {
    await context.close();
  }
  return { records, errors, scene };
}

/** Fresh hasTouch context per coarse run; the scene is reseeded each time. */
async function runCoarseSeries(browser, url, settings) {
  const records = [];
  const errors = [];
  for (const run of COARSE_RUNS) {
    const context = await browser.newContext({
      viewport: { width: run.width, height: run.height },
      hasTouch: true,
      isMobile: false,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(run.label + ' pageerror: ' + error.message));
    try {
      await navigateToEditor(page, url);
      await buildDenseScene(page);
      records.push({ run, record: await captureRun(page, run, settings) });
    } catch (error) {
      errors.push(run.label + ': ' + (error && error.message ? error.message : String(error)));
    } finally {
      await context.close();
    }
  }
  return { records, errors };
}

/** Collapse one record into the report's run row. */
function describeRun(entry) {
  return {
    label: entry.run.label,
    viewport: { width: entry.run.width, height: entry.run.height },
    media: entry.record.timeline.media,
    metrics: entry.record.metrics,
    steps: entry.record.steps,
    screenshots: entry.record.screenshots,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const commit = shortSha();
  const outDir = options.out
    ? path.resolve(ROOT, options.out)
    : path.join(DENSE_SCREENSHOT_ROOT, commit, 'dense');
  mkdirSync(outDir, { recursive: true });
  const settings = { outDir, screenshots: options.screenshots };
  const command =
    'node scripts/responsive/dense-data.mjs' + (argv.length > 0 ? ' ' + argv.join(' ') : '');
  const errors = [];
  const records = [];
  let scene = null;
  let fatalError = null;
  let browser = null;
  process.on('exit', stopChildren);
  try {
    const editor = await ensureEditor({ editorUrl: options.editorUrl });
    console.log('[dense] editor: ' + editor.url + (editor.started ? ' (started)' : ' (reused)'));
    browser = await launchBrowser();
    const fine = await runFineSeries(browser, editor.url, settings);
    errors.push(...fine.errors);
    scene = fine.scene;
    records.push(...fine.records);
    const coarse = await runCoarseSeries(browser, editor.url, settings);
    errors.push(...coarse.errors);
    records.push(...coarse.records);
  } catch (error) {
    fatalError = error;
    errors.push('fatal: ' + (error && error.message ? error.message : String(error)));
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    stopChildren();
  }

  const checks = [];
  const runs = [];
  checks.push({
    run: 'scene',
    id: 'scene.denseSeeded',
    pass: scene !== null && scene.layersRows >= 2 && scene.trackRows >= 1,
    expected: '>=2 layers rows and >=1 track row',
    measured: scene,
  });
  for (const entry of records) {
    const asserted = assertDenseRun({
      run: entry.run.label,
      timeline: entry.record.timeline,
      layersRest: entry.record.layersRest,
      layersHover: entry.record.layersHover,
    });
    for (const item of asserted.checks) checks.push(item);
    entry.record.metrics = asserted.metrics;
    runs.push(describeRun(entry));
  }
  const generatedAt = new Date().toISOString();
  const summary = writeReport(outDir, {
    schema: 1,
    generatedAt,
    commit,
    command,
    scene,
    runs,
    checks,
    errors,
    fatalError: fatalError ? fatalError.message : null,
  });
  for (const item of checks) {
    if (!item.pass) {
      console.log(
        'FAIL ' +
          item.run +
          ' ' +
          item.id +
          ' expected=' +
          item.expected +
          ' measured=' +
          JSON.stringify(item.measured),
      );
    }
  }
  for (const error of errors) console.log('ERROR ' + error);
  console.log('');
  console.log(
    'SUMMARY ' +
      summary.result +
      ': ' +
      summary.passed +
      '/' +
      summary.total +
      ' checks, ' +
      summary.failed +
      ' failed',
  );
  console.log('OUT ' + relativeToRoot(outDir));
  return summary.result === 'PASS' && fatalError === null ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('[dense] fatal: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
