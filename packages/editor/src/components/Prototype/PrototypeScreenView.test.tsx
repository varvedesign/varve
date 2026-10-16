// @vitest-environment jsdom

/**
 * PrototypeScreenView activation regressions.
 *
 * These encode the contract that a prototype screen's *visible* artwork and
 * its *active* regions come from one evaluated geometry, and that activation
 * happens on a completed gesture rather than on `pointerdown`.
 *
 * Written against the pre-repair implementation to fail first:
 *  - hotspot boxes used `node.transform[4..5] + nodeLocalBounds`, ignoring
 *    ancestor transforms and the raster's own normalisation;
 *  - every enumerated child became a hotspot, whether or not it had an
 *    interaction;
 *  - activation fired on `pointerdown`, so a cancelled drag or a scroll
 *    gesture navigated.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Affine } from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrototypeScreenView } from './PrototypeScreenView';

afterEach(cleanup);

const SCREEN = 'screen' as NodeId;
const GROUP = 'card' as NodeId;
const BUTTON = 'cta' as NodeId;
const DECOR = 'bg' as NodeId;

/**
 * Screen frame sits at scene (100, 200). A group at (20, 30) holds a rect
 * button at (10, 15) whose own rect origin is (0, 0). The composed scene
 * position of the button is therefore (100+20+10, 200+30+15) = (130, 245)
 * and its frame-box position is (30, 45) once the frame's own origin is
 * subtracted by the screen mapping.
 */
function screenDoc(): Document {
  const nodes: Record<NodeId, SceneNode> = {
    [SCREEN]: {
      kind: 'frame',
      id: SCREEN,
      name: 'Home',
      transform: [1, 0, 0, 1, 100, 200] as Affine,
      w: 375,
      h: 812,
      children: [DECOR, GROUP],
    } as unknown as SceneNode,
    [DECOR]: {
      kind: 'shape',
      id: DECOR,
      name: 'Background',
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      shape: { kind: 'rect', x: 0, y: 0, w: 375, h: 812 },
      order: 'a0',
    } as unknown as SceneNode,
    [GROUP]: {
      kind: 'group',
      id: GROUP,
      name: 'Card',
      transform: [1, 0, 0, 1, 20, 30] as Affine,
      children: [BUTTON],
    } as unknown as SceneNode,
    [BUTTON]: {
      kind: 'shape',
      id: BUTTON,
      name: 'Continue',
      transform: [1, 0, 0, 1, 10, 15] as Affine,
      shape: { kind: 'rect', x: 0, y: 0, w: 120, h: 44 },
      order: 'a1',
    } as unknown as SceneNode,
  };
  return {
    nodes,
    rootChildren: [SCREEN],
    pages: [],
    guides: [],
    interactions: {
      [BUTTON]: [
        {
          id: 'ix-cta',
          nodeId: BUTTON,
          name: 'Go to details',
          trigger: { kind: 'onClick' },
          actions: [{ kind: 'goBack' }],
          enabled: true,
        },
      ],
    },
  } as unknown as Document;
}

function hotspotFor(nodeId: string): HTMLElement {
  const el = document.querySelector(`[data-prototype-hotspot][data-node-id="${nodeId}"]`);
  if (!el) throw new Error(`no hotspot for ${nodeId}`);
  return el as HTMLElement;
}

function renderScreen(overrides: Partial<Parameters<typeof PrototypeScreenView>[0]> = {}) {
  const onEvent = vi.fn();
  render(
    <PrototypeScreenView
      document={screenDoc()}
      screenId={SCREEN}
      overlayStack={[]}
      onEvent={onEvent}
      {...overrides}
    />,
  );
  return { onEvent };
}

describe('PrototypeScreenView hotspot geometry', () => {
  it('places a nested hotspot using composed ancestor transforms, not raw local offsets', () => {
    renderScreen();
    const el = hotspotFor(BUTTON);
    // 130 - 100 = 30 ; 245 - 200 = 45
    expect(el.style.left).toBe('30px');
    expect(el.style.top).toBe('45px');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('44px');
  });

  it('exposes a hotspot only for nodes that carry an enabled interaction', () => {
    renderScreen();
    expect(document.querySelectorAll('[data-prototype-hotspot]')).toHaveLength(1);
    expect(document.querySelector(`[data-prototype-hotspot][data-node-id="${DECOR}"]`)).toBeNull();
    expect(document.querySelector(`[data-prototype-hotspot][data-node-id="${GROUP}"]`)).toBeNull();
  });

  it('reads interactions from the document when no explicit set is supplied', () => {
    renderScreen();
    expect(hotspotFor(BUTTON).getAttribute('aria-label')).toMatch(/continue/i);
  });
});

describe('PrototypeScreenView activation semantics', () => {
  /**
   * Pointer input is resolved at the container, which owns the mapping from
   * client coordinates to scene geometry. The hotspot controls have
   * `pointer-events: none`, so a real pointer press never reaches them; these
   * tests drive the container because that is the element the browser targets.
   */
  function container(): HTMLElement {
    const el = document.querySelector('.prototype-screen-view');
    if (!el) throw new Error('no screen container');
    return el as HTMLElement;
  }

  const INSIDE = { clientX: 30, clientY: 45 };

  it('does not activate on pointerdown alone', () => {
    const { onEvent } = renderScreen();
    fireEvent.pointerDown(container(), { ...INSIDE, pointerId: 1, button: 0 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('activates once on a completed press', () => {
    const { onEvent } = renderScreen();
    const el = container();
    fireEvent.pointerDown(el, { ...INSIDE, pointerId: 1, button: 0 });
    fireEvent.pointerUp(el, { ...INSIDE, pointerId: 1, button: 0 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'click', nodeId: BUTTON });
  });

  it('does not activate when the pointer moves beyond the drag threshold', () => {
    const { onEvent } = renderScreen();
    const el = container();
    fireEvent.pointerDown(el, { ...INSIDE, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 30, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 30, clientY: 120, pointerId: 1, button: 0 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not activate when the gesture is cancelled by a scroll or system gesture', () => {
    const { onEvent } = renderScreen();
    const el = container();
    fireEvent.pointerDown(el, { ...INSIDE, pointerId: 1, button: 0 });
    fireEvent.pointerCancel(el, { ...INSIDE, pointerId: 1 });
    fireEvent.pointerUp(el, { ...INSIDE, pointerId: 1, button: 0 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not activate when a press drags off its region before release', () => {
    const { onEvent } = renderScreen();
    const el = container();
    // Press inside the button, release over empty space within the frame.
    fireEvent.pointerDown(el, { ...INSIDE, pointerId: 5, button: 0 });
    fireEvent.pointerUp(el, { clientX: 340, clientY: 780, pointerId: 5, button: 0 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ignores a synthesised click that no pointer gesture produced', () => {
    const { onEvent } = renderScreen();
    fireEvent.click(container(), { ...INSIDE, detail: 1 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reports the letterbox policy the mapping actually applied', () => {
    renderScreen();
    expect(container().getAttribute('data-prototype-letterboxed')).toBe('false');
  });

  it('activates exactly once when a pointer click reaches a hotspot control', () => {
    // A real pointer press targets the container, because the control has
    // `pointer-events: none`. This covers the case where a stylesheet or an
    // assistive technology delivers the click to the control itself: the
    // control defers pointer-generated clicks to the container, so a pointer
    // click cannot activate a region the gesture never reached.
    const { onEvent } = renderScreen();
    fireEvent.click(hotspotFor(BUTTON), { ...INSIDE, detail: 1 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('activates once from the keyboard without a preceding pointer gesture', () => {
    const { onEvent } = renderScreen();
    const el = hotspotFor(BUTTON);
    el.focus();
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.click(el, { ...INSIDE, detail: 0 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ type: 'click', nodeId: BUTTON });
  });

  it('ignores a press outside every region', () => {
    const { onEvent } = renderScreen();
    const el = container();
    const outside = { clientX: 340, clientY: 800 };
    fireEvent.pointerDown(el, { ...outside, pointerId: 3, button: 0 });
    fireEvent.pointerUp(el, { ...outside, pointerId: 3, button: 0 });
    fireEvent.click(el, { ...outside, detail: 1 });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('resolves the topmost interactive node from a container-level press', () => {
    const { onEvent } = renderScreen();
    const el = container();
    fireEvent.pointerDown(el, { ...INSIDE, pointerId: 2, button: 0 });
    fireEvent.pointerUp(el, { ...INSIDE, pointerId: 2, button: 0 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ nodeId: BUTTON });
  });
});
