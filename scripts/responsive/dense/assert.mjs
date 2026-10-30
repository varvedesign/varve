/**
 * Pure assertions for one dense-data run.
 *
 * Thresholds trace to docs/responsive/screenshots/1009de823/dense/
 * EVIDENCE-dense.md (task 03a/03b acceptance): 28px timeline rows, one 120px
 * label authority, 24px target boxes and reachable docked row actions.
 */

const TARGET_MIN = 23.5;
const EFFECTIVE_MIN = 24;
const LABEL_WIDTH = 120;
const LABEL_WIDTH_TOLERANCE = 2;
const ROW_HEIGHT_MIN = 26;
const ROW_HEIGHT_MAX = 30;
const DOCKED_PANEL_MIN = 250;
/** Documented coarse-pointer residual for the docked 1180 layers Solo action. */
const LAYERS_COARSE_EFFECTIVE_MIN = 20;

function within(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function check(run, id, pass, expected, measured) {
  return { run, id, pass: pass === true, expected, measured };
}

function targetMetric(targetValue) {
  if (!targetValue) return null;
  return {
    width: targetValue.rect ? targetValue.rect.width : null,
    height: targetValue.rect ? targetValue.rect.height : null,
    display: targetValue.style ? targetValue.style.display : null,
    hit: targetValue.hit ? targetValue.hit.hit : null,
    hitPoints: targetValue.hitPoints
      ? targetValue.hitPoints.owned + '/' + targetValue.hitPoints.total
      : null,
    effectiveWidth: targetValue.extent ? targetValue.extent.effectiveWidth : null,
    effectiveHeight: targetValue.extent ? targetValue.extent.effectiveHeight : null,
  };
}

function sizeOf(targetValue) {
  return targetValue && targetValue.rect
    ? { width: targetValue.rect.width, height: targetValue.rect.height }
    : null;
}

function hitOf(targetValue) {
  return targetValue && targetValue.hit ? targetValue.hit.hit : null;
}

function extentOf(targetValue) {
  return targetValue && targetValue.extent
    ? { width: targetValue.extent.effectiveWidth, height: targetValue.extent.effectiveHeight }
    : null;
}

function assertTarget(add, id, targetValue, options = {}) {
  const minimum = options.minimum === undefined ? TARGET_MIN : options.minimum;
  const effectiveMin = options.effectiveMin === undefined ? EFFECTIVE_MIN : options.effectiveMin;
  const size = sizeOf(targetValue);
  const extent = extentOf(targetValue);
  const points = targetValue ? targetValue.hitPoints : null;
  add(
    id + '.box',
    size !== null && size.width >= minimum && size.height >= minimum,
    'box >= ' + minimum + 'x' + minimum,
    size,
  );
  add(
    id + '.centreHit',
    hitOf(targetValue) === true,
    'elementFromPoint(centre) resolves to target',
    targetValue ? targetValue.hit : null,
  );
  add(
    id + '.effective',
    extent !== null && extent.width >= effectiveMin && extent.height >= EFFECTIVE_MIN,
    'effective >= ' + effectiveMin + 'x' + EFFECTIVE_MIN,
    extent,
  );
  if (options.fullBox === true) {
    add(
      id + '.fullBoxHit',
      points !== null && points.total > 0 && points.owned === points.total,
      '9-of-9 inset points resolve to target',
      points,
    );
  }
}

/**
 * @param {{ run: string, timeline: object, layersRest: object, layersHover: object }} input
 * @returns {{ checks: object[], metrics: object }}
 */
export function assertDenseRun({ run, timeline, layersRest, layersHover }) {
  const checks = [];
  const add = (id, pass, expected, measured) =>
    checks.push(check(run, id, pass, expected, measured));
  const coarse = run.endsWith('-coarse');
  const documentState = timeline.document;
  add(
    'document.noHorizontalOverflow',
    documentState.scrollWidth <= documentState.innerWidth + 1,
    'scrollWidth <= innerWidth + 1',
    { scrollWidth: documentState.scrollWidth, innerWidth: documentState.innerWidth },
  );
  add(
    'media.emulation',
    coarse
      ? timeline.media.pointerCoarse && timeline.media.hoverNone
      : !timeline.media.pointerCoarse && timeline.media.hoverHover,
    coarse ? 'coarse pointer, no hover' : 'fine pointer, hover',
    {
      pointerCoarse: timeline.media.pointerCoarse,
      hoverHover: timeline.media.hoverHover,
      compactTier: timeline.media.compactTier,
    },
  );

  const timelineState = timeline.timeline;
  const row = timelineState.row;
  const label = timelineState.label;
  add(
    'timeline.row.height',
    row !== null && within(row.rect.height, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX),
    'row height ' + ROW_HEIGHT_MIN + '-' + ROW_HEIGHT_MAX + 'px',
    row ? row.rect.height : null,
  );
  add(
    'timeline.label.authority',
    label !== null &&
      within(
        label.rect.width,
        LABEL_WIDTH - LABEL_WIDTH_TOLERANCE,
        LABEL_WIDTH + LABEL_WIDTH_TOLERANCE,
      ) &&
      label.style.fontSize === '13px',
    'label ' + LABEL_WIDTH + 'px +/- ' + LABEL_WIDTH_TOLERANCE + ', 13px font',
    label ? { width: label.rect.width, fontSize: label.style.fontSize } : null,
  );
  add(
    'timeline.label.unclipped',
    label !== null &&
      label.contentClippedY === false &&
      row !== null &&
      label.rect.height <= row.rect.height + 0.5,
    'label fits vertically inside the row',
    label && row
      ? {
          labelHeight: label.rect.height,
          rowHeight: row.rect.height,
          contentClippedY: label.contentClippedY,
        }
      : null,
  );
  assertTarget(add, 'timeline.mute', timelineState.mute);
  assertTarget(add, 'timeline.solo', timelineState.solo, { fullBox: true });
  add(
    'timeline.solo.notCovered',
    timelineState.keyframeOverlapsSolo === 0,
    'no keyframe rect overlaps Solo',
    timelineState.keyframeOverlapsSolo,
  );
  const playback = timelineState.playback ? timelineState.playback.reach : null;
  add(
    'timeline.playback.overflowReachable',
    playback !== null && (playback.scrollsX === false || playback.scrollLeftAchievable === true),
    'any transport overflow is scrollable',
    playback
      ? {
          maxScrollWidth: playback.maxScrollWidth,
          scrollLeftAchievable: playback.scrollLeftAchievable,
        }
      : null,
  );
  const tracks = timelineState.tracks ? timelineState.tracks.reach : null;
  add(
    'timeline.tracks.noClippedOverflow',
    tracks !== null && tracks.scrollsX === false,
    'track content fits horizontally',
    tracks ? { scrollWidth: tracks.scrollWidth, clientWidth: tracks.clientWidth } : null,
  );

  const hover = layersHover.layers;
  const rest = layersRest.layers;
  const panel = hover.panel;
  const content = hover.contentScroll;
  const layersRow = hover.row;
  add(
    'layers.panel.visible',
    panel !== null && panel.rect.width >= DOCKED_PANEL_MIN,
    'panel width >= ' + DOCKED_PANEL_MIN + 'px',
    panel ? panel.rect : null,
  );
  add(
    'layers.content.noHorizontalOverflow',
    content !== null && content.scrollsX === false,
    'layer content fits horizontally',
    content ? { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth } : null,
  );
  add(
    'layers.row.fits',
    layersRow !== null &&
      panel !== null &&
      content !== null &&
      layersRow.rect.right <= panel.rect.right - 1 &&
      layersRow.rect.width <= content.clientWidth + 1,
    'row inside panel content',
    layersRow && panel
      ? {
          rowRight: layersRow.rect.right,
          panelRight: panel.rect.right,
          rowWidth: layersRow.rect.width,
          contentWidth: content.clientWidth,
        }
      : null,
  );
  const effectiveMin = coarse ? LAYERS_COARSE_EFFECTIVE_MIN : EFFECTIVE_MIN;
  assertTarget(add, 'layers.solo.hover', hover.soloAction, {
    effectiveMin,
    fullBox: !coarse,
  });
  const docked = run.startsWith('1180') || run.startsWith('1366');
  if (docked) {
    assertTarget(add, 'layers.solo.rest', rest.soloAction, {
      effectiveMin,
      fullBox: !coarse,
    });
  }
  if (run === '1366x1024-fine') {
    const details = rest.detailsTrigger;
    add(
      'layers.details.restTarget',
      details !== null &&
        details.rect.width >= TARGET_MIN &&
        details.rect.height >= TARGET_MIN &&
        hitOf(details) === true,
      'details 24px target reachable at 1366',
      details ? targetMetric(details) : null,
    );
  }

  const metrics = {
    document: { scrollWidth: documentState.scrollWidth, innerWidth: documentState.innerWidth },
    timeline: {
      rowHeight: row ? row.rect.height : null,
      label: label
        ? {
            width: label.rect.width,
            height: label.rect.height,
            fontSize: label.style.fontSize,
            contentClippedY: label.contentClippedY,
          }
        : null,
      mute: targetMetric(timelineState.mute),
      solo: targetMetric(timelineState.solo),
      keyframeCount: timelineState.keyframeCount,
      keyframeOverlapsSolo: timelineState.keyframeOverlapsSolo,
      playbackMaxScrollWidth: playback ? playback.maxScrollWidth : null,
      playbackScrollLeftAchievable: playback ? playback.scrollLeftAchievable : null,
      tracksScrollWidth: tracks ? tracks.scrollWidth : null,
      tracksClientWidth: tracks ? tracks.clientWidth : null,
    },
    layers: {
      panel: panel
        ? {
            width: panel.rect.width,
            position:
              hover.presentation && hover.presentation.layersPanel
                ? hover.presentation.layersPanel.position
                : null,
          }
        : null,
      row: layersRow ? { width: layersRow.rect.width, height: layersRow.rect.height } : null,
      soloHover: targetMetric(hover.soloAction),
      soloRest: targetMetric(rest.soloAction),
      detailsRest: targetMetric(rest.detailsTrigger),
      disclosure: targetMetric(hover.disclosure),
    },
  };
  return { checks, metrics };
}
