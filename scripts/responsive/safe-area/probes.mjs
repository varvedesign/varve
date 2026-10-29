/**
 * Assertion builders for the safe-area harness.
 *
 * Page-side probes live in page-probes.mjs (serialized into page.evaluate);
 * this module owns named checks so the report stays readable and every
 * function stays inside the 50-line ceiling.
 */
import { TOLERANCE } from './config.mjs';

export function numberFromCss(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function makeChecks() {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  };
  return { checks, check };
}

const near = (value, expected) =>
  Math.abs((numberFromCss(value) ?? Number.NaN) - expected) <= TOLERANCE;

/** viewport meta, shell padding, chrome offsets and overflow. */
export function buildShellChecks(shell, label, insets) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  check(
    name('viewport meta has viewport-fit=cover'),
    typeof shell.viewportMeta === 'string' &&
      shell.viewportMeta.indexOf('viewport-fit=cover') !== -1,
    shell.viewportMeta,
  );
  const pad = shell.shell;
  check(
    name('shell carries all four safe-area insets'),
    near(pad.paddingTop, insets.top) &&
      near(pad.paddingRight, insets.right) &&
      near(pad.paddingBottom, insets.bottom) &&
      near(pad.paddingLeft, insets.left),
    pad,
  );
  check(
    name('menubar starts below the top inset'),
    shell.menubar !== null && shell.menubar.top >= insets.top - TOLERANCE,
    shell.menubar,
  );
  check(
    name('tab strip starts after the left inset'),
    shell.tabs !== null && shell.tabs.left >= insets.left - TOLERANCE,
    shell.tabs,
  );
  check(
    name('status bar sits above the bottom inset'),
    shell.status !== null && shell.status.bottom <= shell.innerHeight - insets.bottom + TOLERANCE,
    shell.status,
  );
  check(name('no page horizontal overflow'), shell.scrollWidth <= shell.innerWidth + 1, {
    scrollWidth: shell.scrollWidth,
    innerWidth: shell.innerWidth,
  });
  return checks;
}

/** Fixed drawers, launchers and toasts; presence is asserted, not assumed. */
export function buildOverlayChecks(shell, overlays, label, insets, inspectorMode) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  const drawer = overlays.layersDrawer;
  check(
    name('layers drawer is notch-safe'),
    drawer.position === 'fixed' &&
      near(drawer.left, insets.left) &&
      near(drawer.bottom, insets.bottom),
    drawer,
  );
  const inspector = overlays.inspectorDrawer;
  if (inspectorMode === 'portrait-sheet') {
    check(
      name('inspector bottom sheet pads the bottom inset'),
      inspector.position === 'fixed' &&
        near(inspector.bottom, 0) &&
        near(inspector.paddingBottom, insets.bottom),
      inspector,
    );
  } else {
    check(
      name('inspector side drawer is notch-safe'),
      near(inspector.right, insets.right) && near(inspector.bottom, insets.bottom),
      inspector,
    );
  }
  const fabLayers = overlays.fabLayers;
  check(
    name('layers launcher is rendered'),
    fabLayers.display !== 'none' && fabLayers.box !== null,
    fabLayers,
  );
  if (fabLayers.box) {
    check(
      name('layers launcher clears the left inset'),
      fabLayers.box.left >= insets.left - TOLERANCE,
      fabLayers.box,
    );
    check(
      name('layers launcher clears the bottom inset'),
      fabLayers.box.bottom <= shell.innerHeight - insets.bottom + TOLERANCE,
      fabLayers.box,
    );
  }
  const fabInspector = overlays.fabInspector;
  if (fabInspector.display !== 'none' && fabInspector.box) {
    check(
      name('inspector launcher clears the right inset'),
      fabInspector.box.right <= shell.innerWidth - insets.right + TOLERANCE,
      fabInspector.box,
    );
  }
  const toast = overlays.toast;
  check(name('toast container is rendered'), toast.exists === true, toast);
  if (toast.exists) {
    check(
      name('toast clears the bottom inset'),
      numberFromCss(toast.bottom) >= insets.bottom - TOLERANCE,
      toast,
    );
    check(
      name('toast clears the right inset'),
      numberFromCss(toast.right) >= insets.right - TOLERANCE,
      toast,
    );
  }
  return checks;
}

/**
 * Tablet-mode launchers keep their inspector-aware offsets. Assertions use the
 * computed left/right values because the Layers launcher is legitimately
 * display:none when a persisted dock projection owns the lower-left hit
 * region; a display:none element still resolves its specified offset.
 */
export function buildTabletChecks(shell, overlays, label, insets, mirrored) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  const inspectorFloor = 280;
  const layers = overlays.fabLayers;
  const library = overlays.fabLibrary;
  check(name('tablet layout mode is active'), shell.layoutMode === 'tablet', shell.layoutMode);
  check(name('layers launcher exists'), layers.exists === true, layers.exists);
  check(name('library launcher exists'), library.exists === true, library.exists);
  const layersLeft = numberFromCss(layers.left);
  const layersRight = numberFromCss(layers.right);
  const libraryLeft = numberFromCss(library.left);
  const libraryRight = numberFromCss(library.right);
  if (mirrored) {
    check(
      name('mirrored layers launcher keeps the inspector offset and right inset'),
      layersRight !== null && layersRight >= inspectorFloor + insets.right - TOLERANCE,
      { right: layers.right },
    );
    check(
      name('mirrored library launcher clears the left inset'),
      libraryLeft !== null && libraryLeft >= insets.left - TOLERANCE,
      { left: library.left },
    );
  } else {
    check(
      name('layers launcher clears the left inset'),
      layersLeft !== null && layersLeft >= insets.left - TOLERANCE,
      { left: layers.left },
    );
    check(
      name('library launcher keeps the inspector offset and right inset'),
      libraryRight !== null && libraryRight >= inspectorFloor + insets.right - TOLERANCE,
      { right: library.right },
    );
  }
  return checks;
}

/**
 * Differential check: emulated insets versus the CDP-cleared baseline. If a
 * viewport-anchored offset forgets the inset, the delta between the two
 * measurements is short by exactly the emulated value and this fails.
 */
export function buildInsetPropagationChecks(insetState, baselineState, label, insets) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  const delta = (withValue, withoutValue, expected, suffix) => {
    const usable =
      typeof withValue === 'number' &&
      typeof withoutValue === 'number' &&
      Number.isFinite(withValue + withoutValue);
    if (!usable) {
      check(name(suffix), false, { withValue, withoutValue });
      return;
    }
    const change = Math.abs(withValue - withoutValue);
    check(name(suffix), Math.abs(change - expected) <= TOLERANCE, {
      withValue,
      withoutValue,
      change,
      expected,
    });
  };
  const withTabs = insetState.shell.tabs;
  const baseTabs = baselineState.shell.tabs;
  const withMenubar = insetState.shell.menubar;
  const baseMenubar = baselineState.shell.menubar;
  const withStatus = insetState.shell.status;
  const baseStatus = baselineState.shell.status;
  const withDrawer = insetState.overlays.layersDrawer.box;
  const baseDrawer = baselineState.overlays.layersDrawer.box;
  delta(
    withTabs ? withTabs.bottom : null,
    baseTabs ? baseTabs.bottom : null,
    insets.top,
    'top inset reaches the tab strip',
  );
  if (insetState.overlays.layersDrawer.position === 'fixed') {
    delta(
      withDrawer ? withDrawer.top : null,
      baseDrawer ? baseDrawer.top : null,
      insets.top,
      'top inset reaches the fixed drawer anchor',
    );
  } else {
    check(name('fixed drawer anchor applies to this presentation'), true, {
      skipped: true,
      reason: 'drawer is an in-flow docked panel here, not a viewport-fixed drawer',
      position: insetState.overlays.layersDrawer.position,
    });
  }
  delta(
    withMenubar ? withMenubar.top : null,
    baseMenubar ? baseMenubar.top : null,
    insets.top,
    'top inset reaches the menubar',
  );
  delta(
    baseStatus ? baseStatus.bottom : null,
    withStatus ? withStatus.bottom : null,
    insets.bottom,
    'bottom inset lifts the status bar',
  );
  return checks;
}

/** Distraction-free exit control lands inside the inset viewport. */
export function buildExitFocusChecks(shell, overlays, label, insets) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  const exit = overlays.exitFocus;
  check(
    name('distraction-free exit control is rendered'),
    exit.exists === true && exit.box !== null,
    exit,
  );
  if (exit.box) {
    check(
      name('exit control clears the top inset'),
      exit.box.top >= insets.top - TOLERANCE,
      exit.box,
    );
    check(
      name('exit control clears the right inset'),
      exit.box.right <= shell.innerWidth - insets.right + TOLERANCE,
      exit.box,
    );
  }
  return checks;
}

/** Desktop/Tauri control: env()=0 must add no padding or offset anywhere. */
export function buildDesktopBaselineChecks(shell, overlays, label) {
  const { checks, check } = makeChecks();
  const name = (suffix) => `${label}: ${suffix}`;
  check(
    name('viewport meta has viewport-fit=cover'),
    typeof shell.viewportMeta === 'string' &&
      shell.viewportMeta.indexOf('viewport-fit=cover') !== -1,
    shell.viewportMeta,
  );
  check(
    name('shell padding is zero without insets'),
    near(shell.shell.paddingTop, 0) &&
      near(shell.shell.paddingRight, 0) &&
      near(shell.shell.paddingBottom, 0) &&
      near(shell.shell.paddingLeft, 0),
    shell.shell,
  );
  check(
    name('menubar is flush to the viewport top'),
    shell.menubar !== null && Math.abs(shell.menubar.top) <= TOLERANCE,
    shell.menubar,
  );
  check(
    name('tab strip is flush to the viewport left'),
    shell.tabs !== null && Math.abs(shell.tabs.left) <= TOLERANCE,
    shell.tabs,
  );
  check(
    name('status bar reaches the viewport bottom'),
    shell.status !== null && Math.abs(shell.status.bottom - shell.innerHeight) <= TOLERANCE,
    shell.status,
  );
  check(
    name('desktop launchers stay hidden'),
    overlays.fabLayers.display === 'none',
    overlays.fabLayers.display,
  );
  check(name('no page horizontal overflow'), shell.scrollWidth <= shell.innerWidth + 1, {
    scrollWidth: shell.scrollWidth,
    innerWidth: shell.innerWidth,
  });
  return checks;
}
