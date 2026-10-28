// ── Workload drivers ────────────────────────────────────────────────────────
// Workloads are driven through real CDP pointer/keyboard input, not through an
// in-page hook. A synthetic driver would exercise a code path users never take
// and would skip the browser's own event dispatch, coalescing and hit-testing
// — which is where a material share of interaction latency lives.

/** Open a new document and return the canvas bounding box. */
export async function openEditorCanvas(page) {
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30_000 });
  await page
    .waitForFunction(
      () => document.querySelector('.startup-loader')?.getAttribute('aria-busy') !== 'true',
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(?: design)?$/i })
    .first()
    .click({ force: true, timeout: 15_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 20_000 });

  // Dismiss anything modal left open; a dialog over the canvas would swallow
  // the pointer input every workload depends on.
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('dialog[open]').count()) === 0) break;
    const close = page
      .locator('dialog[open]')
      .last()
      .getByRole('button', { name: /close/i })
      .first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  return canvas.boundingBox();
}

/**
 * Apply a deterministic corpus fixture as the open document. The fixture
 * documents live in the editor's workload corpus (single source of truth),
 * so the checksum and node count come from the same code the unit tests
 * exercise. The apply path replaces the document in the open editor — the
 * web build runs on the memory platform, so IndexedDB seeding cannot reach
 * the home screen.
 */
export async function openFixtureEditor(page, fixtureId) {
  // The perf handle (and therefore the fixture applier) is installed by
  // CanvasArea on mount, so an editor page must exist first.
  await openEditorCanvas(page);
  await page.waitForFunction(() => Boolean(window.__varvePerf), undefined, { timeout: 30_000 });
  const seeded = await page.evaluate(async (id) => {
    const perf = window.__varvePerf;
    if (!perf?.fixtures?.apply) return { ok: false, error: 'fixtures.apply missing' };
    return perf.fixtures.apply(id);
  }, fixtureId);
  if (!seeded?.ok) {
    throw new Error(`fixture apply failed for '${fixtureId}' (${seeded?.error ?? 'unknown'})`);
  }
  // Wait for the fixture to render before measuring.
  await page.waitForTimeout(2500);
  // Applying a document can re-open the welcome dialog over the canvas;
  // dismiss any modal so pointer input reaches the canvas.
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('dialog[open]').count()) === 0) break;
    const close = page
      .locator('dialog[open]')
      .last()
      .getByRole('button', { name: /close|get started/i })
      .first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  return { seeded, box };
}

/**
 * Where the fixture-drag workload should start. Grid fixtures have a known
 * layout (rects at `spacing` apart, first cell at 0,0) so the click point is
 * computable; dense fixtures fall back to the viewport centre, which reliably
 * hits *something*. `--fixture-drag=x,y` overrides everything.
 */
/**
 * Draw a seed grid, then double it `duplications` times.
 * Each duplicated batch is nudged well clear of its source. Without that the
 * copies land essentially on top of each other, and every node then falls
 * inside any single node's dirty region — which makes `prunableByDirty`
 * structurally zero and renders the fixture unable to answer whether a
 * dirty-region query could prune anything. A spread scene is the only version
 * of this fixture that can.
 */
export async function buildScene(page, box, duplications, spread = true) {
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    await page.keyboard.press('r');
    await page.waitForTimeout(60);
    await page.mouse.move(box.x + 60 + col * 160, box.y + 60 + row * 160);
    await page.mouse.down();
    await page.mouse.move(box.x + 130 + col * 160, box.y + 120 + row * 160);
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  for (let i = 0; i < duplications; i++) {
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(25);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(60);
    if (spread) {
      // Shift+Arrow is the large-step nudge; the duplicate is still selected.
      const horizontal = i % 2 === 0;
      for (let step = 0; step < 12; step++) {
        await page.keyboard.press(horizontal ? 'Shift+ArrowRight' : 'Shift+ArrowDown');
      }
      await page.waitForTimeout(60);
    }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // A dedicated drag target drawn last, at a known location. Relying on a
  // fixed coordinate hitting one of the seed rects is fragile: after the
  // spread nudges above, a click can land on empty canvas, and the "drag"
  // silently becomes a marquee that never mutates the document — which makes
  // every frame report `clean` and looks exactly like partial redraw being
  // broken. Drawing the target explicitly removes that failure mode.
  const targetX = box.x + box.width * 0.5;
  const targetY = box.y + box.height * 0.5;
  await page.keyboard.press('r');
  await page.waitForTimeout(80);
  await page.mouse.move(targetX - 60, targetY - 40);
  await page.mouse.down();
  await page.mouse.move(targetX + 60, targetY + 40);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);

  const nodeCount = await page.evaluate(() => {
    const perf = window.__varvePerf;
    const frames = perf?.getFrames?.(3) ?? [];
    return frames.length ? frames[frames.length - 1].nodeCount : 0;
  });
  return { nodeCount, dragTarget: { x: targetX, y: targetY } };
}

/**
 * Dismiss any modal (welcome dialog can re-open asynchronously after a
 * document apply) and verify the drag point still hits the content canvas,
 * so a workload can never silently measure nothing.
 */
export async function ensureCanvasHitTarget(page, dragTarget) {
  // The welcome dialog can open a beat after the fixture apply; retry the
  // dismissal + hit check so a late dialog cannot invalidate a workload.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 4; i++) {
      if ((await page.locator('dialog[open]').count()) === 0) break;
      const close = page
        .locator('dialog[open]')
        .last()
        .getByRole('button', { name: /close|get started/i })
        .first();
      if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
        await close.click({ force: true });
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(50);
    }
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el?.closest?.('.editor-canvas'));
    }, dragTarget);
    if (hit) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * Select the first node in the layers panel, then resolve a drag point clear
 * of the selection handle grid. Every node centre carries its own 16px move
 * handle (pointer-events:auto, stops propagation), and the corner handles
 * extend 8px inward along each edge — so the safe point is 16px inside the
 * left edge at the box's vertical centre.
 */
export async function resolveDragTarget(page, seedPoint) {
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  const row = page.getByRole('treeitem').first();
  if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) return seedPoint;
  await row.click({ force: true });
  await page.waitForTimeout(400);
  const target = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    const canvasBounds = canvas?.getBoundingClientRect();
    if (!canvasBounds || canvasBounds.width <= 0 || canvasBounds.height <= 0) return null;
    const rects = [...document.querySelectorAll('.editor-canvas svg rect')]
      .filter((r) => (r.getAttribute('style') || '').includes('resize'))
      .map((r) => {
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y };
      });
    if (rects.length < 4) return null;
    const xs = rects.map((r) => r.x);
    const ys = rects.map((r) => r.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // 16px inside the left edge, vertically centred: clear of the corner
    // handles (8px inward), the edge handles (centred on the edges) and the
    // centre move handle.
    const candidate = { x: minX + 16, y: (minY + maxY) / 2 };
    // Virtualized/rotated overlays can expose stale SVG handles outside the
    // actual content surface. Never let that diagnostic geometry replace a
    // known fixture point with an off-canvas coordinate; the hit assertion
    // below should measure the workload, not fail on overlay bookkeeping.
    if (
      candidate.x < canvasBounds.left ||
      candidate.x > canvasBounds.right ||
      candidate.y < canvasBounds.top ||
      candidate.y > canvasBounds.bottom
    ) {
      return null;
    }
    // The canvas surface can be transformed or expose a world-sized backing
    // rect, so a bounds-only check is insufficient. Confirm the browser's
    // actual hit-test sees the editor surface at this viewport coordinate.
    if (!document.elementFromPoint(candidate.x, candidate.y)?.closest('.editor-canvas')) {
      return null;
    }
    return candidate;
  });
  return target ?? seedPoint;
}
