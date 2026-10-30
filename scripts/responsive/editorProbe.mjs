/**
 * Editor probes for the responsive matrix.
 *
 * probeEditorLayout is serialized into the page by capture.mjs; the other
 * helpers drive Pill reachability and turn one measurement into checks.
 * Extracted from capture.mjs to keep both files under the 400-line budget.
 */

/** Serialized into the page: editor shell geometry for one viewport. */
export function probeEditorLayout() {
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (element) => {
    if (!element) return null;
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left: round(left), top: round(top), right: round(right), bottom: round(bottom) };
  };
  const inside = (rect) =>
    rect !== null &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= window.innerWidth + 1 &&
    rect.bottom <= window.innerHeight + 1;
  const hitAt = (element, rect) => {
    if (!element || rect === null) return false;
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit === element || (hit !== null && element.contains(hit));
  };
  const scrollOf = (element) => {
    if (!element) return null;
    const { scrollWidth, clientWidth } = element;
    return {
      scrollWidth,
      clientWidth,
      scrollable: scrollWidth > clientWidth + 1,
      overflowX: window.getComputedStyle(element).overflowX,
    };
  };
  const labelOf = (element) =>
    (element.getAttribute('aria-label') || element.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  const headerRow = document.querySelector('.editor-shell__header-row');
  const share = headerRow?.querySelector('.collab-header-control, .varve-btn');
  const bar = document.querySelector('.context-control-bar');
  const shareRect = rectOf(share);
  const barRect = rectOf(bar);
  const pills = [...document.querySelectorAll('.context-control-bar .ccb__tool-pill')].map(
    (pill, index) => {
      const rect = rectOf(pill);
      return { index, label: labelOf(pill), rect, inside: inside(rect), hit: hitAt(pill, rect) };
    },
  );
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    shell: rectOf(document.querySelector('.editor-shell')),
    headerRow: rectOf(headerRow),
    share: { rect: shareRect, inside: inside(shareRect), hit: hitAt(share, shareRect) },
    contextBar: { rect: barRect, inside: inside(barRect), ...(scrollOf(bar) || {}) },
    pills,
    internalScroll: {
      status: scrollOf(document.querySelector('.editor-status')),
      menubarLeft: scrollOf(document.querySelector('.editor-menubar__left')),
    },
  };
}

/** Scroll one context-bar pill into view, wait, then re-measure it. */
export async function scrollPillIntoView(page, index) {
  return page.evaluate(async (pillIndex) => {
    const round = (value) => Math.round(value * 10) / 10;
    const pill = document.querySelectorAll('.context-control-bar .ccb__tool-pill')[pillIndex];
    if (!pill) return null;
    pill.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const rect = pill.getBoundingClientRect();
    const inside =
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      left: round(rect.left),
      inside,
      hit: hit === pill || (hit !== null && pill.contains(hit)),
    };
  }, index);
}

/** Measure pill reachability, scrolling the bar only when it can scroll. */
export async function checkPillReachability(page, measurement) {
  const unreachable = [];
  let scrolledIntoSight = 0;
  const bar = measurement.contextBar;
  for (const pill of measurement.pills) {
    if (pill.inside && pill.hit) continue;
    if (!bar.scrollable || !bar.inside) {
      unreachable.push({
        label: pill.label,
        left: pill.rect === null ? null : pill.rect.left,
        viaScroll: false,
        reason: 'context bar box exceeds the viewport',
      });
      continue;
    }
    const after = await scrollPillIntoView(page, pill.index);
    if (after?.inside && after.hit) scrolledIntoSight += 1;
    else
      unreachable.push({
        label: pill.label,
        left: after === null ? null : after.left,
        viaScroll: true,
        reason: 'still unreachable after scrolling the context bar',
      });
  }
  await page.evaluate(() => {
    const bar = document.querySelector('.context-control-bar');
    if (bar) bar.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(120);
  return { unreachable, scrolledIntoSight };
}

/** Per-viewport editor assertions. */
export function buildEditorChecks(measurement, viewport, reachability) {
  const { width, height } = measurement.viewport;
  const { shell, headerRow, share } = measurement;
  const pills = measurement.pills;
  const unreachable = reachability.unreachable;
  const record = (id, pass, expected, measured, detail) => ({
    app: 'editor',
    viewport: viewport.label,
    id,
    pass,
    expected,
    measured,
    ...(detail ? { detail } : {}),
  });
  return [
    record(
      'editor.page-overflow',
      measurement.doc.scrollWidth <= width + 1,
      'documentElement.scrollWidth <= innerWidth + 1',
      { scrollWidth: measurement.doc.scrollWidth, innerWidth: width },
    ),
    record(
      'editor.shell-bounds',
      shell !== null &&
        shell.left >= -1 &&
        shell.top >= -1 &&
        shell.right <= width + 1 &&
        shell.bottom <= height + 1,
      'editor-shell bounding box inside the viewport',
      { shell },
    ),
    record(
      'editor.header-row-right',
      headerRow !== null && headerRow.right <= width + 1,
      'editor-shell__header-row right edge <= innerWidth + 1',
      { headerRow },
    ),
    record(
      'editor.share-bounds',
      share.rect !== null && share.rect.left >= -1 && share.rect.right <= width + 1,
      'collab-header-control right edge <= innerWidth + 1',
      { share: share.rect, innerWidth: width },
    ),
    record(
      'editor.share-hit',
      share.hit,
      'elementFromPoint at collab-header-control centre hits it or a descendant',
      { share: share.rect, hit: share.hit },
    ),
    record(
      'editor.context-pills-present',
      pills.length > 0,
      'at least one context-control-bar tool pill rendered',
      { count: pills.length },
    ),
    record(
      'editor.context-pills-reachable',
      unreachable.length === 0,
      'every ccb__tool-pill reachable in the viewport',
      {
        total: pills.length,
        reachable: pills.length - unreachable.length,
        scrolledIntoSight: reachability.scrolledIntoSight,
        unreachable,
      },
      unreachable.map((pill) => pill.label).join(', '),
    ),
  ];
}
