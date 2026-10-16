import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../panelDefinitions';
import { resetPanelRegistry } from '../panelRegistry';
import {
  getDockCanvasRect,
  getDockPanelPlacements,
  projectVisibleDockTree,
  resolveDockFloatingGroupGeometry,
  resolveDockTreeGeometry,
} from './dockGeometry';
import { getDockNodeMaximumSize, resetSplitRatio, setSplitRatio } from './dockOps';
import type { DockFloatingGroup, DockNode } from './dockTypes';
import { createDefaultEditorDockLayout } from './editorDockLayout';

const node: DockNode = {
  kind: 'split',
  id: 'root',
  direction: 'row',
  ratio: 0.25,
  first: { kind: 'panel', id: 'layers-node', panelInstanceId: 'layers-1', panelTypeId: 'layers' },
  second: {
    kind: 'split',
    id: 'main',
    direction: 'column',
    ratio: 0.75,
    first: { kind: 'canvas', id: 'canvas' },
    second: {
      kind: 'tabs',
      id: 'bottom-tabs',
      activePanelInstanceId: 'email-1',
      panels: [
        { instanceId: 'timeline-1', panelTypeId: 'timeline' },
        { instanceId: 'email-1', panelTypeId: 'emailPreview' },
      ],
    },
  },
};

describe('dock geometry', () => {
  beforeEach(() => {
    resetPanelRegistry();
    registerBuiltinPanels();
  });

  it('projects nested splits and tab visibility to normalized panel placements', () => {
    const placements = getDockPanelPlacements(node);
    expect(placements).toEqual([
      {
        panelTypeId: 'layers',
        panelInstanceId: 'layers-1',
        rect: { x: 0, y: 0, width: 0.25, height: 1 },
        active: true,
      },
      {
        panelTypeId: 'timeline',
        panelInstanceId: 'timeline-1',
        rect: { x: 0.25, y: 0.75, width: 0.75, height: 0.25 },
        active: false,
        tabGroupNodeId: 'bottom-tabs',
      },
      {
        panelTypeId: 'emailPreview',
        panelInstanceId: 'email-1',
        rect: { x: 0.25, y: 0.75, width: 0.75, height: 0.25 },
        active: true,
        tabGroupNodeId: 'bottom-tabs',
      },
    ]);
  });

  it('clamps defensive ratios before calculating geometry', () => {
    const placements = getDockPanelPlacements({
      kind: 'split',
      id: 'bad-ratio',
      direction: 'row',
      ratio: Number.NaN,
      first: { kind: 'panel', id: 'p', panelInstanceId: 'layers-1', panelTypeId: 'layers' },
      second: { kind: 'canvas', id: 'canvas' },
    });
    expect(placements[0]?.rect).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
  });

  it('reclaims the hidden panel branch without mutating the saved tree', () => {
    const projected = projectVisibleDockTree(node, { layers: false });
    expect(getDockCanvasRect(projected)).toEqual({ x: 0, y: 0, width: 1, height: 0.75 });
    expect(getDockPanelPlacements(projected).map((placement) => placement.panelTypeId)).toEqual([
      'timeline',
      'emailPreview',
    ]);
    expect(getDockCanvasRect(node)).toEqual({ x: 0.25, y: 0, width: 0.75, height: 0.75 });
  });

  it('keeps registered desktop minimum sizes when the host can satisfy them', () => {
    const { panels, canvas, minimumSize } = resolveDockTreeGeometry(
      {
        kind: 'split',
        id: 'shell',
        direction: 'row',
        ratio: 0.22,
        first: { kind: 'panel', id: 'layers', panelInstanceId: 'l', panelTypeId: 'layers' },
        second: {
          kind: 'split',
          id: 'main',
          direction: 'row',
          ratio: 0.74,
          first: { kind: 'canvas', id: 'canvas' },
          second: {
            kind: 'panel',
            id: 'inspector',
            panelInstanceId: 'i',
            panelTypeId: 'inspector',
          },
        },
      },
      900,
      600,
    );
    expect(minimumSize).toEqual({ width: 740, height: 240 });
    expect(panels.map((placement) => [placement.panelTypeId, placement.rect.width])).toEqual([
      ['layers', 198],
      ['inspector', 240],
    ]);
    expect(canvas?.width).toBe(462);
    expect(canvas?.width).toBeGreaterThanOrEqual(320);
  });

  it('keeps declared preferred widths on a roomy host and gives surplus to the canvas', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const layout = createDefaultEditorDockLayout('design');
    const root = layout.windows[0]!.dockRoot;
    // 2560px: the ratio would paint a 563px Layers rail and a 619px Inspector
    // against a registry that declares 288 and 320. Measured before this rule:
    // the inline widths matched 0.22*width / 0.31*remainder at 1024/1280/1366
    // (docs/audits/responsive-panels-controls-2026-10-15.md).
    const geometry = resolveDockTreeGeometry(root, 2560, 1440);
    const widths = Object.fromEntries(
      geometry.panels.map((placement) => [placement.panelTypeId, placement.rect.width]),
    );
    expect(widths.layers).toBe(288);
    expect(widths.inspector).toBe(320);
    expect(geometry.canvas?.width).toBe(2560 - 288 - 320);
  });

  it('keeps the default narrow-host allocation exactly as the ratio gave it', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    // The preferred ceiling must never *grow* a pane: at 900px the ratio is the
    // smaller number and the canvas keeps its floor. This is the pairing to the
    // 2560px case — the same rule, both ends.
    const geometry = resolveDockTreeGeometry(root, 900, 600);
    expect(
      geometry.panels.map((placement) => [placement.panelTypeId, placement.rect.width]),
    ).toEqual([
      ['layers', 198],
      ['inspector', 240],
    ]);
    expect(geometry.canvas?.width).toBe(462);
  });

  it('lets an explicitly resized pane grow to its declared maximum, not beyond', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    // Inspector dragged wide: the split is no longer at its built-in ratio, so
    // the preferred ceiling stops applying and the declared maximum is the
    // bound. The inspector's maximum is 2 x preferredSize (640): the width the
    // inspector specs already exercise as "wide" (240 min / 320 default / 640).
    const dragged = setSplitRatio(root, 'center-inspector', 0.3);
    const geometry = resolveDockTreeGeometry(dragged, 1920, 1080);
    const inspector = geometry.panels.find((panel) => panel.panelTypeId === 'inspector');
    expect(inspector?.rect.width).toBe(640);

    // The layers rail is untouched by that drag and keeps its own contract.
    const layers = geometry.panels.find((panel) => panel.panelTypeId === 'layers');
    expect(layers?.rect.width).toBe(288);
  });

  it('bounds a dragged layers rail by its declared maximum', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    const dragged = setSplitRatio(root, 'layers-main', 0.5);
    const geometry = resolveDockTreeGeometry(dragged, 2560, 1440);
    const layers = geometry.panels.find((panel) => panel.panelTypeId === 'layers');
    expect(layers?.rect.width).toBe(576);
  });

  it('honours a resize that lands on a built-in split’s creation ratio', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    // The repository's own spec caught this: at 1440 the Layers rail opens at
    // its preferred 288 (effective ratio 0.2), and the first ArrowRight stores
    // 0.2 + 0.02 = 0.22 -- exactly the built-in creation ratio. Inferring
    // "untouched" from that value re-armed the preferred ceiling and swallowed
    // the keypress (aria-valuenow stayed 20). Touched-ness is state now.
    expect(resolveDockTreeGeometry(root, 1440, 900).panels[0]!.rect.width).toBe(288);
    const nudged = setSplitRatio(root, 'layers-main', 0.22);
    const layers = resolveDockTreeGeometry(nudged, 1440, 900).panels.find(
      (panel) => panel.panelTypeId === 'layers',
    );
    expect(layers?.rect.width).toBeCloseTo(0.22 * 1440, 5);

    // ...and the same is true for a drag that lands on the default value.
    expect(setSplitRatio(root, 'layers-main', 0.22)).toMatchObject({ ratioTouched: true });
    // The stored ratio is untouched by this bookkeeping, so nothing else moves.
    expect(setSplitRatio(root, 'layers-main', 0.25)).toMatchObject({ ratio: 0.25 });
  });

  it('keeps the untouched preferred rule for a split nobody has resized', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    const geometry = resolveDockTreeGeometry(root, 1440, 900);
    expect(geometry.panels.find((panel) => panel.panelTypeId === 'layers')?.rect.width).toBe(288);
    // The Motion companion split is untouched too. At 900px of height the
    // ratio share is the smaller number, so it still governs (unchanged
    // behaviour); on a taller host the declared preferred height caps it —
    // and that cap is the panel *body* plus the 32px chrome the dock draws
    // above it, which is the asymmetry this pins.
    const motionRoot = createDefaultEditorDockLayout('motion').windows[0]!.dockRoot;
    const heightOf = (height: number) =>
      resolveDockTreeGeometry(motionRoot, 1440, height).panels.find(
        (panel) => panel.panelTypeId === 'timeline',
      )?.rect.height;
    expect(heightOf(900)).toBe(252);
    expect(heightOf(1200)).toBe(272);

    // A tab-group pane draws one row of chrome (its strip), not two: the Email
    // companion's declared 220px body opens as 252, not 284.
    const emailRoot = createDefaultEditorDockLayout('email').windows[0]!.dockRoot;
    const emailPane = resolveDockTreeGeometry(emailRoot, 2560, 1440).panels.find(
      (panel) => panel.panelTypeId === 'emailPreview',
    );
    expect(emailPane?.rect.height).toBe(252);
  });

  it('returns a built-in split to its default ratio and preferred opening', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    const dragged = setSplitRatio(root, 'layers-main', 0.5);
    const widthOf = (node: typeof root) =>
      resolveDockTreeGeometry(node, 2560, 1440).panels.find(
        (panel) => panel.panelTypeId === 'layers',
      )?.rect.width;

    expect(widthOf(dragged)).toBe(576);
    const reset = resetSplitRatio(dragged, 'layers-main');
    // Back to the creation ratio *and* to the state where the declared
    // preferred size governs again — that is what makes this a reset rather
    // than a mere ratio write.
    expect(widthOf(reset)).toBe(288);
    expect(reset).toMatchObject({ ratio: 0.22 });
    expect(reset).not.toHaveProperty('ratioTouched');

    // A split the user created has no default to return to.
    const userSplit: DockNode = {
      kind: 'split',
      id: 'user-split',
      direction: 'row',
      ratio: 0.4,
      first: { kind: 'canvas', id: 'c' },
      second: { kind: 'panel', id: 'p', panelInstanceId: 'l-1', panelTypeId: 'layers' },
    };
    expect(resetSplitRatio(userSplit, 'user-split')).toBe(userSplit);
  });

  it('names each splitter after the pane it sizes', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const design = resolveDockTreeGeometry(
      createDefaultEditorDockLayout('design').windows[0]!.dockRoot,
      1440,
      900,
    );
    const names = Object.fromEntries(
      design.splitters.map((splitter) => [splitter.nodeId, splitter.accessibleName]),
    );
    // Two splitters with identical names gave a screen-reader user no way to
    // tell which one had focus (APG window splitter names the pane).
    expect(names['layers-main']).toBe('Resize Layers panel');
    expect(names['center-inspector']).toBe('Resize Inspector panel');
    expect(new Set(Object.values(names)).size).toBe(Object.keys(names).length);

    const motion = resolveDockTreeGeometry(
      createDefaultEditorDockLayout('motion').windows[0]!.dockRoot,
      1440,
      900,
    );
    const columnSplit = motion.splitters.find((splitter) => splitter.direction === 'column');
    expect(columnSplit?.accessibleName).toBe('Resize Timeline panel');
  });

  it('points aria-controls only at panes whose container element exists', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    const design = resolveDockTreeGeometry(
      createDefaultEditorDockLayout('design').windows[0]!.dockRoot,
      1440,
      900,
    );
    const controls = Object.fromEntries(
      design.splitters.map((splitter) => [splitter.nodeId, splitter.controlledElementId]),
    );
    // These ids are rendered by Shell.tsx; a splitter pointing at a
    // non-existent id is worse than one with no aria-controls at all.
    expect(controls['layers-main']).toBe('editor-layers-panel');
    expect(controls['center-inspector']).toBe('editor-inspector-panel');

    // The Motion workspace's companion splitter sizes Timeline, whose container
    // is rendered by WorkspaceBottomPanels and carries no id.
    const motion = resolveDockTreeGeometry(
      createDefaultEditorDockLayout('motion').windows[0]!.dockRoot,
      1440,
      900,
    );
    const companion = motion.splitters.find((splitter) => splitter.direction === 'column');
    expect(companion?.controlledElementId).toBeNull();
  });

  it('sizes a split between two bounded panels by its ratio, not by a maxima sum', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    // No canvas competes for this region: the host is legitimately wider than
    // both panels' maxima together, so the stored ratio (the user's own
    // arrangement of one region) decides. What must never happen is a pane
    // falling below its own minimum or the split inverting.
    const root: DockNode = {
      kind: 'split',
      id: 'bottom-row',
      direction: 'row',
      ratio: 0.5,
      first: {
        kind: 'tabs',
        id: 'bottom-tabs',
        activePanelInstanceId: 'email-1',
        panels: [
          { instanceId: 'email-1', panelTypeId: 'emailPreview' },
          { instanceId: 'email-2', panelTypeId: 'emailOutput' },
        ],
      },
      second: {
        kind: 'panel',
        id: 'library-panel',
        panelInstanceId: 'library-1',
        panelTypeId: 'library',
      },
    };
    const geometry = resolveDockTreeGeometry(root, 1952, 600);
    const library = geometry.panels.find((panel) => panel.panelTypeId === 'library');
    const email = geometry.panels.find((panel) => panel.panelTypeId === 'emailPreview');
    expect(library?.rect.width).toBe(976);
    expect(email?.rect.width).toBe(976);
    expect(library!.rect.width).toBeGreaterThanOrEqual(220);
  });

  it('reports splitter keyboard bounds that reach the pane maximum', () => {
    const root = createDefaultEditorDockLayout('design').windows[0]!.dockRoot;
    const geometry = resolveDockTreeGeometry(root, 2560, 1440);
    const layersSplit = geometry.splitters.find((splitter) => splitter.nodeId === 'layers-main');
    // End must reach 576/2560 = 22.5%, not 95%: the range is the registry
    // contract, so pointer and keyboard agree on what the panel may become.
    expect(layersSplit?.maxRatio).toBeCloseTo(576 / 2560, 5);
    // ...and the lower bound is a size the resolver can actually produce, not a
    // dead zone: the smallest first-pane share is its minimum, 180/2560.
    expect(layersSplit?.minRatio).toBeCloseTo(180 / 2560, 5);
  });

  it('bounds a node by the tightest maximum below it and leaves the canvas unbounded', () => {
    resetPanelRegistry();
    registerBuiltinPanels();
    // A tab group must satisfy every panel it hosts (mirror of the minimum rule).
    expect(
      getDockNodeMaximumSize({
        kind: 'tabs',
        id: 't',
        panels: [
          { instanceId: 'l', panelTypeId: 'layers' },
          { instanceId: 'i', panelTypeId: 'inspector' },
        ],
      }).width,
    ).toBe(576);
    // The canvas is the flex absorber: a subtree holding it is bounded only by
    // the window, which is what lets surplus width land on the artwork.
    expect(getDockNodeMaximumSize({ kind: 'canvas', id: 'c' }).width).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('exposes tab-group bounds and the active instance for accessible controls', () => {
    const geometry = resolveDockTreeGeometry(node, 800, 600);
    expect(geometry.splitters.map((splitter) => [splitter.nodeId, splitter.direction])).toEqual([
      ['root', 'row'],
      ['main', 'column'],
    ]);
    expect(geometry.splitters[0]?.rect).toEqual({ x: 188, y: 0, width: 24, height: 600 });
    expect(geometry.splitters[1]?.rect).toEqual({ x: 200, y: 396, width: 600, height: 24 });
    expect(geometry.tabGroups).toEqual([
      {
        nodeId: 'bottom-tabs',
        rect: { x: 200, y: 408, width: 600, height: 192 },
        activePanelInstanceId: 'email-1',
        panels: [
          { instanceId: 'timeline-1', panelTypeId: 'timeline' },
          { instanceId: 'email-1', panelTypeId: 'emailPreview' },
        ],
      },
    ]);
    expect(geometry.panels[1]?.tabGroupNodeId).toBe('bottom-tabs');
    expect(geometry.panels[2]?.tabGroupNodeId).toBe('bottom-tabs');
  });

  it('scales float placement with the editor window and keeps a visible header', () => {
    const group: DockFloatingGroup = {
      id: 'float-layers',
      panels: [{ instanceId: 'layers-1', panelTypeId: 'layers' }],
      activePanelInstanceId: 'layers-1',
      normalizedBounds: { x: 0.2, y: 0.1, width: 0.4, height: 0.5 },
    };
    const placement = resolveDockFloatingGroupGeometry(group, 1000, 800);
    expect(placement.rect).toEqual({ x: 200, y: 80, width: 400, height: 400 });
    expect(placement.headerRect).toEqual({ x: 200, y: 80, width: 400, height: 36 });
    expect(placement.contentRect).toEqual({ x: 200, y: 116, width: 400, height: 364 });
    expect(placement.panels).toEqual([
      expect.objectContaining({
        panelTypeId: 'layers',
        panelInstanceId: 'layers-1',
        active: true,
        floatingGroupId: 'float-layers',
      }),
    ]);
  });
});
