/**
 * Page-side measurement for the dense-data responsive probe.
 *
 * One serializable probe function collects geometry, hit-testing and scroll
 * state for the timeline or the layers panel. Thresholds and verdicts live in
 * assert.mjs; this module only reports facts.
 */

/** Measure the timeline row, label, transport targets and scrollers. */
export function measureTimeline(page) {
  return page.evaluate(probeDense, 'timeline');
}

/** Measure the layers panel, row fit and row-action reachability. */
export function measureLayers(page) {
  return page.evaluate(probeDense, 'layers');
}

/** Runs inside the page; must stay self-contained (serialized by evaluate). */
function probeDense(mode) {
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      left: round(box.left),
      top: round(box.top),
      right: round(box.right),
      bottom: round(box.bottom),
      width: round(box.width),
      height: round(box.height),
    };
  };
  const styleOf = (element, properties) => {
    if (!element) return null;
    const computed = getComputedStyle(element);
    const out = {};
    for (const property of properties) out[property] = computed[property];
    return out;
  };
  const centreHit = (element) => {
    if (!element) return { hit: false, reason: 'missing' };
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return { hit: false, reason: 'zero-box' };
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
      return { hit: false, reason: 'offscreen' };
    }
    const found = document.elementFromPoint(x, y);
    return {
      hit: found === element || (found !== null && element.contains(found)),
      target: found ? found.tagName.toLowerCase() : 'none',
    };
  };
  const hitPoints = (element) => {
    if (!element) return { owned: 0, total: 0 };
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return { owned: 0, total: 0 };
    const fractions = [0.1, 0.5, 0.9];
    let owned = 0;
    let total = 0;
    for (const fractionX of fractions) {
      for (const fractionY of fractions) {
        total += 1;
        const found = document.elementFromPoint(
          box.left + box.width * fractionX,
          box.top + box.height * fractionY,
        );
        if (found !== null && (found === element || element.contains(found))) owned += 1;
      }
    }
    return { owned, total };
  };
  const extentOf = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      return { ownsCentre: false, effectiveWidth: 0, effectiveHeight: 0 };
    }
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    const owns = (x, y) => {
      const found = document.elementFromPoint(x, y);
      return found !== null && (found === element || element.contains(found));
    };
    if (!owns(centreX, centreY))
      return { ownsCentre: false, effectiveWidth: 0, effectiveHeight: 0 };
    const side = (dx, dy) => {
      let depth = 0;
      for (let step = 1; step <= 24; step += 1) {
        if (owns(centreX + dx * step, centreY + dy * step)) depth = step;
        else break;
      }
      return depth;
    };
    return {
      ownsCentre: true,
      effectiveWidth: side(-1, 0) + side(1, 0) + 1,
      effectiveHeight: side(0, -1) + side(0, 1) + 1,
    };
  };
  const limitsOf = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollsX: element.scrollWidth > element.clientWidth + 1,
      scrollsY: element.scrollHeight > element.clientHeight + 1,
    };
  };
  const reachOf = (element) => {
    if (!element) return null;
    const limits = limitsOf(element);
    const maxScrollWidth = limits.scrollWidth - limits.clientWidth;
    let scrollLeftAchievable = null;
    if (maxScrollWidth > 0) {
      const before = element.scrollLeft;
      element.scrollLeft = maxScrollWidth;
      scrollLeftAchievable = element.scrollLeft > before;
      element.scrollLeft = before;
    }
    return { ...limits, maxScrollWidth, scrollLeftAchievable };
  };
  const target = (element) => {
    if (!element) return null;
    return {
      rect: rectOf(element),
      style: styleOf(element, [
        'display',
        'visibility',
        'opacity',
        'inlineSize',
        'minWidth',
        'minHeight',
      ]),
      hit: centreHit(element),
      hitPoints: hitPoints(element),
      extent: extentOf(element),
    };
  };
  const media = {
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    anyPointerCoarse: matchMedia('(any-pointer: coarse)').matches,
    anyPointerFine: matchMedia('(any-pointer: fine)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    hoverHover: matchMedia('(hover: hover)').matches,
    compactTier: matchMedia('(max-width: 899px)').matches,
  };
  const documentState = {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
  };
  const layersPanelElement = document.querySelector('#editor-layers-panel');
  const fabLayers = document.querySelector('.editor__fab--layers');
  const presentation = {
    fabLayersVisible: fabLayers
      ? (() => {
          const style = getComputedStyle(fabLayers);
          return style.display !== 'none' && fabLayers.getBoundingClientRect().width > 2;
        })()
      : false,
    layersPanel: layersPanelElement
      ? {
          rect: rectOf(layersPanelElement),
          display: getComputedStyle(layersPanelElement).display,
          visibility: getComputedStyle(layersPanelElement).visibility,
          position: getComputedStyle(layersPanelElement).position,
          backdrop: document.querySelector('.editor__panel-backdrop') !== null,
        }
      : null,
  };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  if (mode === 'layers') {
    const content = document.querySelector('.editor-layers.layers-panel__content');
    const rows = Array.from(document.querySelectorAll('.layers-row'));
    const row =
      rows.find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return box.width > 2 && box.left >= 0 && box.left < window.innerWidth;
      }) ||
      rows[0] ||
      null;
    const disclosure = row ? row.querySelector('.layers-row__disclosure') : null;
    const toggles = row ? Array.from(row.querySelectorAll('.layers-row__toggle')) : [];
    return {
      mode,
      viewport,
      media,
      document: documentState,
      presentation,
      layers: {
        panel: target(layersPanelElement),
        panelScroll: limitsOf(layersPanelElement),
        contentScroll: limitsOf(content),
        rowCount: rows.length,
        row: row
          ? {
              rect: rectOf(row),
              style: styleOf(row, ['height', 'minHeight', 'padding', 'gap', 'fontSize']),
            }
          : null,
        disclosure: target(disclosure),
        visibilityToggle: target(toggles[0] || null),
        lockToggle: target(toggles[1] || null),
        detailsTrigger: target(row ? row.querySelector('.layers-row__details-trigger') : null),
        soloAction: target(row ? row.querySelector('[data-row-action="solo"]') : null),
      },
    };
  }
  const timelinePanel = document.querySelector('.timeline-panel');
  const tracksList = document.querySelector('.timeline-panel__tracks');
  const trackRow = document.querySelector('.timeline-track-row');
  const label = trackRow ? trackRow.querySelector('.timeline-track-row__label') : null;
  const mute = trackRow ? trackRow.querySelector('.timeline-track-row__mute-btn') : null;
  const solo = trackRow ? trackRow.querySelector('.timeline-track-row__solo-btn') : null;
  const keyframes = trackRow
    ? Array.from(trackRow.querySelectorAll('.timeline-track-row__keyframe'))
    : [];
  const soloRect = solo ? solo.getBoundingClientRect() : null;
  const overlaps = (first, second) => {
    if (!first || !second) return false;
    return !(
      first.right <= second.left ||
      second.right <= first.left ||
      first.bottom <= second.top ||
      second.bottom <= first.top
    );
  };
  const playbackControls = document.querySelector('.timeline-playback-controls');
  return {
    mode,
    viewport,
    media,
    document: documentState,
    presentation,
    timeline: {
      panel: target(timelinePanel),
      tracks: tracksList ? { rect: rectOf(tracksList), reach: reachOf(tracksList) } : null,
      playback: playbackControls
        ? { rect: rectOf(playbackControls), reach: reachOf(playbackControls) }
        : null,
      trackRowCount: document.querySelectorAll('.timeline-track-row').length,
      row: trackRow
        ? {
            rect: rectOf(trackRow),
            style: styleOf(trackRow, ['height', 'minHeight', 'display', 'alignItems']),
          }
        : null,
      label: label
        ? {
            rect: rectOf(label),
            style: styleOf(label, ['width', 'minWidth', 'fontSize', 'zIndex', 'overflow']),
            scroll: limitsOf(label),
            contentClippedY: label.scrollHeight > label.clientHeight + 1,
          }
        : null,
      mute: target(mute),
      solo: target(solo),
      keyframeCount: keyframes.length,
      keyframeOverlapsSolo: keyframes.filter((keyframe) =>
        overlaps(keyframe.getBoundingClientRect(), soloRect),
      ).length,
    },
  };
}
