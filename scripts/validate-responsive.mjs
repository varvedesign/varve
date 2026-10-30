#!/usr/bin/env node
/**
 * Responsive validation harness CLI: validates the editor shell and the
 * marketing website across a viewport matrix, then writes screenshots plus
 * report.json/report.md. Heavy runs use the shared lease:
 *   XDG_RUNTIME_DIR=/tmp node scripts/quality/heavy-lease.mjs \
 *     "validate:responsive" -- node scripts/validate-responsive.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { captureEditor, captureWebsite, launchBrowser } from './responsive/capture.mjs';
import {
  EDITOR_VIEWPORTS,
  missingEditorSizes,
  renderMarkdownReport,
  WEBSITE_ROUTES,
  WEBSITE_VIEWPORTS,
} from './responsive/matrix.mjs';
import {
  EDITOR_URL,
  ensureEditor,
  ensureWebsite,
  ROOT,
  stopChildren,
} from './responsive/server.mjs';

const SCREENSHOT_ROOT = path.join(ROOT, 'docs', 'responsive', 'screenshots');
const SCHEMA = 1;
const USAGE = `Usage: node scripts/validate-responsive.mjs [options]

  --app editor|website|all  Surface to validate (default: all)
  --out <dir>               Output dir (default: docs/responsive/screenshots/<short-sha>)
  --editor-url <url>        Reuse a running editor (default: ${EDITOR_URL})
  --website-url <url>       Reuse a served website build
  --reuse-website-dist      Skip the astro build; serve apps/website/dist as-is
  --no-screenshots          Assertions only, no PNGs
  --update-manifest         Write <out>/manifest.json for this run
  -h, --help                Show this help`;

function relativePath(target) {
  return path.relative(ROOT, target).split(path.sep).join('/');
}

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function parseArgs(argv) {
  const options = { app: 'all', out: null, editorUrl: null, websiteUrl: null };
  options.screenshots = true;
  options.updateManifest = false;
  options.reuseWebsiteDist = false;
  options.help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--no-screenshots') options.screenshots = false;
    else if (flag === '--update-manifest') options.updateManifest = true;
    else if (flag === '--reuse-website-dist') options.reuseWebsiteDist = true;
    else if (flag === '-h' || flag === '--help') options.help = true;
    else if (
      flag === '--app' ||
      flag === '--out' ||
      flag === '--editor-url' ||
      flag === '--website-url'
    ) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(flag + ' needs a value');
      index += 1;
      if (flag === '--app') options.app = value;
      else if (flag === '--out') options.out = value;
      else if (flag === '--editor-url') options.editorUrl = value.replace(/\/+$/, '');
      else options.websiteUrl = value.replace(/\/+$/, '');
    } else throw new Error('unknown argument: ' + flag);
  }
  if (!['editor', 'website', 'all'].includes(options.app)) {
    throw new Error('--app must be editor, website, or all');
  }
  return options;
}

function prepareOutput(outDir, options) {
  mkdirSync(outDir, { recursive: true });
  if (!options.screenshots) return;
  if (options.app !== 'website')
    rmSync(path.join(outDir, 'editor'), { recursive: true, force: true });
  if (options.app !== 'editor')
    rmSync(path.join(outDir, 'website'), { recursive: true, force: true });
}

function buildReport(context) {
  const { editor, website, fatalError } = context;
  const checks = [...(editor ? editor.checks : []), ...(website ? website.checks : [])];
  if (fatalError) {
    checks.push({
      app: 'harness',
      viewport: '-',
      id: 'harness.fatal',
      pass: false,
      expected: 'harness completes',
      measured: { message: fatalError.message },
    });
  }
  const failed = checks.filter((check) => !check.pass);
  const screenshots = [
    ...(editor ? editor.screenshots : []),
    ...(website ? website.screenshots : []),
  ];
  let bytes = 0;
  for (const relative of screenshots) {
    try {
      bytes += statSync(path.join(context.outDir, relative)).size;
    } catch {
      /* a missing screenshot shows up as a failed count below */
    }
  }
  return {
    schemaVersion: SCHEMA,
    generatedAt: context.generatedAt,
    command: context.command,
    gitSha: context.sha,
    options: {
      app: context.options.app,
      screenshots: context.options.screenshots,
      updateManifest: context.options.updateManifest,
      reuseWebsiteDist: context.options.reuseWebsiteDist,
      outDir: relativePath(context.outDir),
    },
    editor: editor || null,
    website: website || null,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      result: failed.length === 0 ? 'PASS' : 'FAIL',
      screenshotCount: screenshots.length,
      screenshotBytes: bytes,
    },
    failures: failed,
    fatalError: fatalError ? fatalError.message : null,
  };
}

function writeManifest(report, outDir) {
  const screenshots = [
    ...(report.editor ? report.editor.screenshots : []),
    ...(report.website ? report.website.screenshots : []),
  ];
  const manifest = {
    gitSha: report.gitSha,
    generatedAt: report.generatedAt,
    result: report.summary.result,
    apps: [report.editor ? 'editor' : null, report.website ? 'website' : null].filter(Boolean),
    screenshots: screenshots.map((relative) => ({
      path: relative,
      bytes: statSync(path.join(outDir, relative)).size,
    })),
  };
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function printSummary(report, outDir) {
  const rows = [];
  for (const app of ['editor', 'website']) {
    const surface = report[app];
    if (!surface) continue;
    for (const row of surface.rows) rows.push({ app, label: row.label, route: row.route || null });
  }
  console.log('', 'RESULT APP     VIEWPORT                      ROUTE               DETAIL');
  for (const row of rows) {
    const ids = report.failures
      .filter(
        (failure) =>
          failure.app === row.app &&
          failure.viewport === row.label &&
          (failure.route || null) === row.route,
      )
      .map((failure) => failure.id);
    const detail = ids.length === 0 ? 'all checks passed' : ids.join(', ');
    console.log(
      `${(ids.length === 0 ? 'PASS' : 'FAIL').padEnd(7)}${row.app.padEnd(8)}${row.label.padEnd(30)}${(row.route || '-').padEnd(20)}${detail.slice(0, 90)}`,
    );
  }
  const summary = report.summary;
  console.log('');
  console.log(
    `SUMMARY ${summary.result}: ${summary.passed}/${summary.total} checks, ${summary.failed} failed, ${summary.screenshotCount} screenshots (${summary.screenshotBytes} bytes)`,
  );
  console.log('OUT ' + relativePath(outDir));
}
async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const sha = gitShortSha();
  const outDir = options.out ? path.resolve(ROOT, options.out) : path.join(SCREENSHOT_ROOT, sha);
  const generatedAt = new Date().toISOString();
  const command =
    'node scripts/validate-responsive.mjs' + (argv.length ? ' ' + argv.join(' ') : '');
  let editor = null;
  let website = null;
  let browser = null;
  let fatalError = null;
  process.on('exit', stopChildren);
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(signal, () => {
      stopChildren();
      process.exit(code);
    });
  }
  prepareOutput(outDir, options);
  try {
    if (options.app !== 'website') {
      const missing = missingEditorSizes();
      if (missing.length > 0) throw new Error('editor matrix missing: ' + missing.join(', '));
    }
    const editorServer = options.app !== 'website' ? await ensureEditor(options) : null;
    const websiteServer = options.app !== 'editor' ? await ensureWebsite(options) : null;
    browser = await launchBrowser();
    const base = { browser, outDir, screenshots: options.screenshots };
    if (editorServer) {
      console.log(
        '[responsive] editor: ' + EDITOR_VIEWPORTS.length + ' viewports at ' + editorServer.url,
      );
      editor = await captureEditor({ ...base, url: editorServer.url, viewports: EDITOR_VIEWPORTS });
      editor.url = editorServer.url;
      editor.started = editorServer.started;
    }
    if (websiteServer) {
      console.log(
        '[responsive] website: ' + WEBSITE_ROUTES.length + ' routes at ' + websiteServer.url,
      );
      website = await captureWebsite({
        ...base,
        baseUrl: websiteServer.url,
        viewports: WEBSITE_VIEWPORTS,
        routes: WEBSITE_ROUTES,
      });
      website.url = websiteServer.url;
      website.started = websiteServer.started;
    }
  } catch (error) {
    fatalError = error instanceof Error ? error : new Error(String(error));
    console.error('[responsive] failed: ' + fatalError.message);
  } finally {
    if (browser !== null) await browser.close().catch(() => {});
    stopChildren();
  }
  const report = buildReport({
    options,
    sha,
    outDir,
    generatedAt,
    command,
    editor,
    website,
    fatalError,
  });
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'report.md'), renderMarkdownReport(report, relativePath(outDir)));
  if (options.updateManifest) writeManifest(report, outDir);
  printSummary(report, outDir);
  return report.summary.result === 'PASS' ? 0 : 1;
}
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      '[responsive] fatal: ' + (error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  });
