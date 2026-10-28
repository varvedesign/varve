import {
  contentCanvasDigest,
  latestInteractionTraceId,
  waitForAuthoritativeCanvasDigest,
  waitForCommittedInteraction,
} from './evidence.mjs';
import { ensureCanvasHitTarget } from './scenarios.mjs';

/**
 * Wait for HandTool inertia to finish before restoring the next sample's
 * camera. Its bounded momentum keeps issuing real camera frames after pointerup;
 * a reset started mid-inertia races the oracle's expected state and invalidates
 * an otherwise correct authoritative redraw.
 */
async function waitForCameraToSettle(page) {
  let previous = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    const camera = await page.evaluate(() => {
      const value = window.__varvePerf?.getFrames?.(1)?.at(-1)?.camera;
      return value
        ? { zoom: value.zoom, panX: value.panX, panY: value.panY, rotation: value.rotation }
        : null;
    });
    if (!camera) throw new Error('cannot verify pan completion without a committed camera frame');
    const identity = JSON.stringify(camera);
    stableSamples = identity === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previous = identity;
    await page.waitForTimeout(50);
  }
  throw new Error('camera inertia did not settle within 2.5 seconds');
}

/**
 * One iteration of a named workload. Each is a real gesture, so the resulting
 * traces cover the whole path from browser event dispatch to frame commit.
 */
let largeBrushTipPrepared = false;
export async function driveWorkload(
  page,
  box,
  workload,
  iteration,
  dragTarget,
  baselineFingerprint = null,
) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const jitter = (iteration % 5) * 3;

  // A drag workload that misses the canvas measures nothing (the previous
  // failure mode: the welcome dialog re-opened over the canvas after the
  // fixture apply and swallowed every pointer event).
  const pointerWorkloads = new Set([
    'single-drag',
    'multi-drag',
    'marquee-select',
    'resize',
    'rotate',
    'alt-drag',
    'nudge',
    'layer-visibility',
    'pan',
    'zoom',
    'brush',
    'brush-large-tip',
    'eraser',
  ]);
  if (pointerWorkloads.has(workload) && !(await ensureCanvasHitTarget(page, dragTarget))) {
    throw new Error(
      `drag target (${dragTarget.x}, ${dragTarget.y}) does not hit the content canvas`,
    );
  }

  switch (workload) {
    case 'pointer-move-idle':
      for (let i = 0; i < 12; i++) {
        await page.mouse.move(cx - 200 + i * 30, cy - 100 + jitter);
        await page.waitForTimeout(8);
      }
      return;

    case 'single-drag': {
      await page.keyboard.press('v');
      // The fixture resolver has already selected the first layer row and
      // chosen an interior point clear of the selection handles. Clicking the
      // canvas here could hit its floating toolbar, leaving the following
      // gesture as the selection click rather than the measured drag.
      if (!(await ensureCanvasHitTarget(page, dragTarget))) {
        throw new Error('resolved drag target no longer hits the content canvas after selection');
      }
      const beforeDragTraceId = await latestInteractionTraceId(page);
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(dragTarget.x + i * 5 + jitter, dragTarget.y + i * 4);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await waitForCommittedInteraction(page, 'pointer-drag', beforeDragTraceId, 'drag');
      await page.waitForTimeout(80);
      if (baselineFingerprint) {
        const movedFingerprint = await contentCanvasDigest(page);
        if (movedFingerprint === baselineFingerprint) {
          throw new Error('drag did not change artwork pixels; pointer missed the selected object');
        }
      }
      // Undo the single drag so every iteration starts from byte-identical
      // artwork; a hand-built inverse drag can leave fractional-pixel residue.
      // The global history shortcut intentionally runs before canvas keyboard
      // tracing, so verify its committed effect with the full-redraw oracle
      // instead of waiting for a keyboard trace that may not exist.
      await page.keyboard.press('Control+z');
      await waitForAuthoritativeCanvasDigest(page, baselineFingerprint, 'undo');
      return;
    }

    case 'multi-drag': {
      await page.keyboard.press('v');
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(40);
      await page.mouse.move(box.x + 120, box.y + 110);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(box.x + 120 + i * 4 + jitter, box.y + 110 + i * 3);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      return;
    }

    case 'marquee-select': {
      await page.keyboard.press('v');
      await page.keyboard.press('Escape');
      await page.mouse.move(cx - 300, cy - 200);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx - 300 + i * 25, cy - 200 + i * 18);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(80);
      return;
    }

    case 'pan': {
      // Space spring-loads the Hand tool through the focused canvas handler.
      // The fixture workflow often leaves focus on its layer row; without
      // returning focus here the browser sends Space elsewhere and this
      // sequence is recorded as a pointer trace that never moves the camera.
      await page.locator('canvas.editor-canvas__content-layer').focus();
      await page.keyboard.down('Space');
      // Avoid racing ToolManager's 150 ms spring-load guard; otherwise the
      // drag starts on the previous tool and does not pan the camera.
      await page.waitForTimeout(175);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx + i * 8, cy + i * 5);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.up('Space');
      // HandTool keeps a short inertial tail after release. Let it finish
      // before sampling camera stability or restoring the canonical camera.
      await page.waitForTimeout(2_000);
      await waitForCameraToSettle(page);
      return;
    }

    case 'zoom': {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'brush':
    case 'brush-large-tip':
    case 'eraser': {
      if (workload === 'eraser') {
        await page.keyboard.press('e');
      } else {
        await page.keyboard.press('b');
        if (workload === 'brush-large-tip' && !largeBrushTipPrepared) {
          for (let index = 0; index < 12; index++) await page.keyboard.press(']');
          largeBrushTipPrepared = true;
        }
      }
      await page.mouse.move(cx - 120, cy + 48);
      await page.mouse.down();
      for (let index = 1; index <= 24; index++) {
        const progress = index / 24;
        await page.mouse.move(
          cx - 120 + progress * 240,
          cy + 48 + Math.sin(progress * Math.PI * 2) * 18,
        );
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(48);
      // Keep every sample on the same committed scene; the measurement keeps
      // only the pointer trace and excludes this reset keystroke.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(64);
      return;
    }

    case 'undo-redo': {
      // Focus the canvas so the keyboard shortcuts reach its handler (the
      // global shortcut path is not traced).
      await page
        .locator('canvas.editor-canvas__content-layer')
        .click({ position: { x: 300, y: 200 } });
      await page.waitForTimeout(80);
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(40);
      }
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Control+Shift+z');
        await page.waitForTimeout(40);
      }
      return;
    }

    // ── Extended interactions (Phase 2 corpus) ─────────────────────────────

    case 'resize': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      // The bottom-right selection handle sits just past the node corner; the
      // drag target rect is 120x80 centred on dragTarget.
      const hx = dragTarget.x + 62;
      const hy = dragTarget.y + 42;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      for (let i = 0; i < 16; i++) {
        await page.mouse.move(hx + i * 3 + jitter, hy + i * 2);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.waitForTimeout(80);
      return;
    }

    case 'rotate': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      // The rotate handle floats above the selection box's top edge.
      const rx = dragTarget.x;
      const ry = dragTarget.y - 64;
      await page.mouse.move(rx, ry);
      await page.mouse.down();
      for (let i = 0; i < 16; i++) {
        await page.mouse.move(rx + i * 3 + jitter, ry - i * 1.5);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      // Undo the rotation so iterations stay comparable.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(80);
      return;
    }

    case 'alt-drag': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      await page.mouse.move(dragTarget.x, dragTarget.y);
      await page.keyboard.down('Alt');
      await page.mouse.down();
      for (let i = 0; i < 14; i++) {
        await page.mouse.move(dragTarget.x + i * 6 + jitter, dragTarget.y + i * 4);
        await page.waitForTimeout(8);
      }
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.waitForTimeout(120);
      // Remove the duplicate so iterations stay comparable.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(80);
      return;
    }

    case 'nudge': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(12);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(12);
      }
      // Return the node to its origin.
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(12);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(12);
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'tool-switch': {
      // Rapid switching between select / rectangle / pen across one canvas.
      const tools = ['v', 'r', 'p', 'e', 'v'];
      for (const key of tools) {
        await page.keyboard.press(key);
        await page.waitForTimeout(40);
      }
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(80);
      return;
    }

    case 'layer-visibility': {
      await page.keyboard.press('v');
      await page.mouse.click(dragTarget.x, dragTarget.y);
      await page.waitForTimeout(80);
      const toggle = page
        .locator('.layers-panel [role="treeitem"]')
        .last()
        .getByRole('button', { name: /eye|visibility|hide|show/i })
        .first();
      for (let i = 0; i < 4; i++) {
        if (await toggle.isVisible({ timeout: 500 }).catch(() => false)) {
          await toggle.click({ force: true });
          await page.waitForTimeout(60);
        }
      }
      await page.waitForTimeout(80);
      return;
    }

    case 'canvas-resize': {
      for (const [w, h] of [
        [1600, 1000],
        [1200, 800],
        [1600, 1000],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(150);
      }
      return;
    }

    default:
      throw new Error(`unknown workload '${workload}'`);
  }
}
