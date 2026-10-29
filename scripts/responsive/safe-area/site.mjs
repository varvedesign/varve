/**
 * Marketing-site half of the safe-area validation harness (task 01a).
 *
 * Serves the already-built apps/website/dist on an ephemeral loopback port,
 * emulates the orientation-appropriate insets over CDP, and asserts the
 * header/footer/container/mobile-nav/consent/skip-link geometry. A stale dist
 * is refused rather than validated against the previous document.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import {
  LANDSCAPE_INSETS,
  numberFromCss,
  PORTRAIT_INSETS,
  READY_TIMEOUT_MS,
  relativeToRoot,
  SITE_DIST,
  TOLERANCE,
} from './config.mjs';

const SITE_SIZES = [
  { width: 375, height: 800, insets: PORTRAIT_INSETS },
  { width: 768, height: 900, insets: PORTRAIT_INSETS },
  { width: 844, height: 390, insets: LANDSCAPE_INSETS },
];

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveFile(request, response) {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.join(SITE_DIST, path.normalize(relative));
  if (!file.startsWith(SITE_DIST + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  const type = CONTENT_TYPES[path.extname(file)] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': type });
  response.end(readFileSync(file));
}

function startSiteServer() {
  const server = createServer(serveFile);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** A stale dist would validate the previous document; refuse it explicitly. */
function siteDistHasCover() {
  const index = path.join(SITE_DIST, 'index.html');
  return existsSync(index) && readFileSync(index, 'utf8').indexOf('viewport-fit=cover') !== -1;
}

function siteProbe() {
  const style = (selector, property) => {
    const element = document.querySelector(selector);
    return element ? getComputedStyle(element)[property] : null;
  };
  const resolvedPx = (property) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.paddingInline = `var(${property})`;
    document.body.appendChild(probe);
    const value = Number.parseFloat(getComputedStyle(probe).paddingLeft);
    probe.remove();
    return Number.isFinite(value) ? value : null;
  };
  const skipLink = document.querySelector('.skip-link');
  if (skipLink) skipLink.focus();
  const skipTop = skipLink ? Number.parseFloat(getComputedStyle(skipLink).top) : null;
  if (skipLink) skipLink.blur();
  const meta = document.querySelector('meta[name=viewport]');
  const container = document.querySelector('.container-custom');
  return {
    viewportMeta: meta ? meta.getAttribute('content') : null,
    pageInlinePx: resolvedPx('--space-page-inline'),
    spaceSmallPx: resolvedPx('--space-2'),
    narrowNav: window.matchMedia('(max-width: 24rem)').matches,
    headerExists: Boolean(document.querySelector('.site-header')),
    footerExists: Boolean(document.querySelector('.site-footer')),
    mobileNavExists: Boolean(document.querySelector('.mobile-nav-dialog')),
    consentExists: Boolean(document.querySelector('.website-analytics-consent')),
    headerPaddingTop: style('.site-header', 'paddingTop'),
    navPaddingLeft: style('.site-nav', 'paddingLeft'),
    navPaddingRight: style('.site-nav', 'paddingRight'),
    footerPaddingBottom: style('.site-footer', 'paddingBottom'),
    containerPaddingLeft: container ? getComputedStyle(container).paddingLeft : null,
    mobileNav: {
      top: style('.mobile-nav-dialog', 'paddingTop'),
      right: style('.mobile-nav-dialog', 'paddingRight'),
      bottom: style('.mobile-nav-dialog', 'paddingBottom'),
      left: style('.mobile-nav-dialog', 'paddingLeft'),
    },
    consent: {
      bottom: style('.website-analytics-consent', 'bottom'),
      right: style('.website-analytics-consent', 'right'),
    },
    skipTop: skipTop,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  };
}

function makeChecks(label) {
  const checks = [];
  const check = (suffix, ok, detail) => {
    checks.push({
      name: `${label}: ${suffix}`,
      ok: Boolean(ok),
      detail: detail === undefined ? null : detail,
    });
  };
  return { checks, check };
}

function buildHeaderChecks(metrics, label, insets) {
  const { checks, check } = makeChecks(label);
  const pageInline = numberFromCss(metrics.pageInlinePx);
  const navBase = numberFromCss(metrics.narrowNav ? metrics.spaceSmallPx : metrics.pageInlinePx);
  check(
    'viewport meta has viewport-fit=cover',
    typeof metrics.viewportMeta === 'string' &&
      metrics.viewportMeta.indexOf('viewport-fit=cover') !== -1,
    metrics.viewportMeta,
  );
  check(
    'header content starts below the top inset',
    metrics.headerExists === true &&
      Math.abs(numberFromCss(metrics.headerPaddingTop) - insets.top) <= TOLERANCE,
    metrics.headerPaddingTop,
  );
  check(
    'site nav inline padding adds the safe gutters',
    navBase !== null &&
      Math.abs(numberFromCss(metrics.navPaddingLeft) - (navBase + insets.left)) <= TOLERANCE &&
      Math.abs(numberFromCss(metrics.navPaddingRight) - (navBase + insets.right)) <= TOLERANCE,
    {
      navBasePx: navBase,
      navPaddingLeft: metrics.navPaddingLeft,
      navPaddingRight: metrics.navPaddingRight,
    },
  );
  check(
    'mobile nav sheet carries all four insets',
    metrics.mobileNavExists === true &&
      Math.abs(numberFromCss(metrics.mobileNav.top) - insets.top) <= TOLERANCE &&
      Math.abs(numberFromCss(metrics.mobileNav.right) - insets.right) <= TOLERANCE &&
      Math.abs(numberFromCss(metrics.mobileNav.bottom) - insets.bottom) <= TOLERANCE &&
      Math.abs(numberFromCss(metrics.mobileNav.left) - insets.left) <= TOLERANCE,
    metrics.mobileNav,
  );
  check(
    'skip link focus clears the top inset',
    metrics.skipTop !== null && metrics.skipTop >= insets.top - TOLERANCE,
    metrics.skipTop,
  );
  if (pageInline === null) {
    check('page-inline token resolved to px for the gutter math', false, metrics.pageInlinePx);
  }
  return checks;
}

function buildFooterChecks(metrics, label, insets) {
  const { checks, check } = makeChecks(label);
  const pageInline = numberFromCss(metrics.pageInlinePx);
  check(
    'footer content sits above the home indicator',
    metrics.footerExists === true &&
      Math.abs(numberFromCss(metrics.footerPaddingBottom) - insets.bottom) <= TOLERANCE,
    metrics.footerPaddingBottom,
  );
  check(
    'shared container adds the safe gutters',
    pageInline !== null &&
      Math.abs(numberFromCss(metrics.containerPaddingLeft) - (pageInline + insets.left)) <=
        TOLERANCE,
    { pageInlinePx: pageInline, containerPaddingLeft: metrics.containerPaddingLeft },
  );
  check(
    'analytics consent card is edge-safe',
    metrics.consentExists === true &&
      pageInline !== null &&
      Math.abs(numberFromCss(metrics.consent.bottom) - (pageInline + insets.bottom)) <= TOLERANCE &&
      Math.abs(numberFromCss(metrics.consent.right) - (pageInline + insets.right)) <= TOLERANCE,
    { pageInlinePx: pageInline, consent: metrics.consent },
  );
  check('no page horizontal overflow', metrics.scrollWidth <= metrics.innerWidth + 1, {
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
  });
  return checks;
}

async function installInsets(context, page, insets) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return cdp;
}

export async function captureSite(browser, options) {
  if (!siteDistHasCover()) {
    options.checks.push({
      name: 'site: built dist contains viewport-fit=cover',
      ok: false,
      detail: 'apps/website/dist is missing or stale; run pnpm build:website first',
    });
    return;
  }
  const { server, port } = await startSiteServer();
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 800 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: 'domcontentloaded',
        timeout: READY_TIMEOUT_MS,
      });
      for (const size of SITE_SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await installInsets(context, page, size.insets);
        await page.waitForTimeout(400);
        const label = `site home ${size.width}x${size.height}`;
        const metrics = await page.evaluate(siteProbe);
        options.checks.push(...buildHeaderChecks(metrics, label, size.insets));
        options.checks.push(...buildFooterChecks(metrics, label, size.insets));
        if (options.screenshots) {
          mkdirSync(options.out, { recursive: true });
          const file = path.join(
            options.out,
            `site-home-${size.width}x${size.height}-safe-area.png`,
          );
          await page.screenshot({ path: file });
          options.screenshotList.push({ file: relativeToRoot(file), viewport: label });
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    server.close();
  }
}
