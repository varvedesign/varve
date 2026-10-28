/**
 * Deterministic settling waits and crop-window measurement used by the scene
 * data and the capture runner.
 */
import { buffersEqual } from '../lib/image-analysis.mjs';

/**
 * Confirms the fonts a scene needs are actually loaded, not just that
 * `document.fonts.ready` resolved.
 *
 * `document.fonts.ready` resolves once pending loads finish; it does not tell
 * you *which* face was selected, and a substitution (a missing family falling
 * back to a default) resolves just as happily. `check()` reports whether a
 * face matching the given font shorthand is available and loaded, so a
 * missing family fails the scene instead of silently shipping substituted
 * type. Chromium headless can also drop default font families after a
 * beyond-viewport capture (playwright#42962), which is why this is asserted
 * per scene rather than once at startup.
 */
export async function waitForFonts(page, families = []) {
  await page.evaluate(() => document.fonts.ready);
  const status = await page.evaluate(() => document.fonts.status);
  if (status !== 'loaded') {
    throw new Error(`fonts did not finish loading (document.fonts.status = "${status}")`);
  }
  for (const family of families) {
    // Wait briefly for a late load to register before declaring it missing.
    const ok = await page
      .waitForFunction(
        (f) =>
          [...document.fonts].some(
            (face) => face.family.replace(/["']/g, '') === f && face.status === 'loaded',
          ),
        family,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      const available = await page.evaluate(() => [...document.fonts].map((f) => f.family));
      throw new Error(
        `required font "${family}" is not loaded (available: ${available.slice(0, 12).join(', ')})`,
      );
    }
  }
}

export async function parkMouse(page, preserveFocus = false, position = { x: 4, y: 4 }) {
  await page.mouse.move(position.x, position.y);
  if (!preserveFocus) await page.evaluate(() => document.activeElement?.blur?.());
}

/**
 * Wait until the canvas region stops changing, bounded.
 *
 * Two animation frames prove nothing about a rendering pipeline that commits
 * later (a worker bitmap, a deferred replay pass), and a fixed sleep is either
 * too short or wasted. This samples the actual canvas box and returns when two
 * consecutive samples are byte-identical, falling back to "best effort" rather
 * than failing: the blank/near-uniform guard after the capture is what catches
 * a canvas that never painted.
 */
export async function waitForStableCanvas(page, { timeoutMs = 6000, intervalMs = 120 } = {}) {
  const box = await page.locator('.editor-canvas').first().boundingBox();
  if (!box || box.width < 4 || box.height < 4) {
    throw new Error('canvas has no measurable geometry before capture');
  }
  const clip = {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    width: Math.max(1, Math.floor(box.width)),
    height: Math.max(1, Math.floor(box.height)),
  };
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  while (Date.now() < deadline) {
    const sample = await page.screenshot({ clip });
    if (previous && buffersEqual(previous, sample)) return true;
    previous = sample;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

/** Wait for rendering to settle: fonts, then a stable canvas, then a parked mouse. */
export async function settle(page, scene = {}) {
  await waitForFonts(page, scene.requireFonts ?? []);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await waitForStableCanvas(page);
  await parkMouse(page, scene.preserveFocus, scene.parkAt);
  await waitForStableCanvas(page, { timeoutMs: 2500 });
}

/**
 * Measure a crop window from a real container instead of fixed coordinates.
 *
 * A scene may declare `clipFrom` — a real container selector — and the clip is
 * measured from that element at capture time. That is preferred for panels,
 * whose internal layout moves as sections are added: the `layers` crop below
 * was tuned to a panel that has since gained a "Design Canvases" block, so its
 * fixed window started framing that block instead of the layer rows.
 */
export async function clipFromLocator(
  page,
  { selector, top, bottom, padding = 0, maxHeight, minHeight },
) {
  const boxOf = async (target) => {
    const box = await page.locator(target).first().boundingBox();
    if (!box || box.width < 8 || box.height < 8) {
      throw new Error(`crop target "${target}" has no measurable layout box`);
    }
    return box;
  };
  // `selector` owns the horizontal extent; `top`/`bottom` (when given) bound the
  // vertical extent, so a crop can frame "from the panel header to the list"
  // without hardcoding either edge.
  const container = await boxOf(selector);
  const topBox = top ? await boxOf(top) : container;
  const bottomBox = bottom ? await boxOf(bottom) : container;
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport unknown while measuring a crop target');
  const left = Math.min(container.x, topBox.x, bottomBox.x);
  const right = Math.max(
    container.x + container.width,
    topBox.x + topBox.width,
    bottomBox.x + bottomBox.width,
  );
  const bottomEdge = Math.max(topBox.y + topBox.height, bottomBox.y + bottomBox.height);
  const x = Math.max(0, Math.floor(left - padding));
  const y = Math.max(0, Math.floor(topBox.y - padding));
  let width = Math.ceil(right - x + padding);
  let height = Math.ceil(bottomEdge - y + padding);
  if (maxHeight) height = Math.min(height, maxHeight);
  if (minHeight) height = Math.max(height, minHeight);
  width = Math.min(width, viewport.width - x);
  height = Math.min(height, viewport.height - y);
  if (width < 8 || height < 8) {
    throw new Error(`crop target "${selector}" measured ${width}x${height} at ${x},${y}`);
  }
  return { x, y, width, height };
}
