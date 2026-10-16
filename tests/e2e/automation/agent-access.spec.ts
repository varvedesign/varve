/**
 * Agent access, in a real browser.
 *
 * Two things the unit tests cannot establish:
 *
 * 1. The Settings surface renders and is operable by keyboard in every theme and
 *    at a compact width, and says plainly that a browser page cannot accept a
 *    local connection.
 * 2. `varve.capture.node` and `varve.document.save` run against the production
 *    export pipeline, not an injected renderer. The control protocol is driven
 *    in-page through the same module instance the application loaded (the
 *    desktop socket cannot exist in a browser), so the part exercised is the
 *    executor, the live editor port and the real pixels - not the Rust socket.
 */
import { expect, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

async function openSettings(page: Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await expect(page.locator('dialog.varve-dialog--settings')).toHaveAttribute('open', '', {
    timeout: 10000,
  });
}

async function openAgentAccess(page: Page) {
  await openSettings(page);
  await page.getByRole('tab', { name: 'Agent Access' }).click();
  await expect(page.getByRole('heading', { name: 'Agent access' })).toBeVisible();
}

const dialog = (page: Page) => page.locator('dialog.varve-dialog--settings');

test.describe('Settings > Agent Access', () => {
  test('starts off and tells the truth about what a browser can do', async ({ page }) => {
    await navigateToEditor(page);
    await openAgentAccess(page);

    const status = page.getByRole('status', { name: 'Agent access status' });
    await expect(status).toContainText('Off');
    await expect(page.getByLabel('Off', { exact: true })).not.toBeChecked();
    await expect(page.getByText('Read only')).toBeVisible();
    await expect(page.getByText('No saving')).toBeVisible();
    await expect(page.getByText('No images')).toBeVisible();

    // Turn it on with the keyboard: the switch is a real control, not a div.
    await page.getByLabel('Off', { exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(status).toContainText('Unavailable here');
    await expect(status).toContainText('desktop application');
    // Nothing to attach to, so no attach command is offered.
    await expect(page.getByText(/varve mcp --instance/)).toHaveCount(0);

    // And off again: the state returns to Off, and the setting persisted both ways.
    await page.getByLabel('On', { exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(status).toContainText('Off');
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('varve-editor-settings');
      return raw ? JSON.parse(raw).automation : null;
    });
    expect(stored).toMatchObject({ enabled: false, grants: 'read', requireApproval: true });
  });

  test('a settings change elsewhere does not restart or reset agent access', async ({ page }) => {
    await navigateToEditor(page);
    await openAgentAccess(page);
    await page.getByLabel('Off', { exact: true }).focus();
    await page.keyboard.press('Space');
    const status = page.getByRole('status', { name: 'Agent access status' });
    await expect(status).toContainText('Unavailable here');

    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByRole('tab', { name: 'Agent Access' }).click();
    await expect(page.getByRole('status', { name: 'Agent access status' })).toContainText(
      'Unavailable here',
    );
  });

  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    test(`is legible in the ${theme} theme and at a compact width`, async ({ page }) => {
      await navigateToEditor(page);
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await openAgentAccess(page);

      // Each state is told by a word as well as by shape, never by colour alone.
      const status = page.getByRole('status', { name: 'Agent access status' });
      await expect(status).toContainText(/Off|Running|Unavailable|Could not start/);

      // Tall enough that the whole section is in the picture, not just its top.
      await page.setViewportSize({ width: 1280, height: 1500 });
      await dialog(page).screenshot({ path: evidencePath(`agent-access/${theme}-wide.png`) });
      // The dialog scrolls; the status line is below the first screenful.
      await status.scrollIntoViewIfNeeded();
      await dialog(page).screenshot({
        path: evidencePath(`agent-access/${theme}-wide-status.png`),
      });

      // 200% scaling is about 640 CSS pixels of a 1280 pixel window.
      await page.setViewportSize({ width: 640, height: 1700 });
      await expect(page.getByRole('heading', { name: 'Agent access' })).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.querySelector('dialog.varve-dialog--settings');
        const panel = root?.querySelector('.agent-access');
        if (!root || !panel) return { missing: true };
        const box = panel.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        return {
          missing: false,
          clippedRight: box.right > bounds.right + 1,
          pageScrolls: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      expect(overflow).toMatchObject({ missing: false, clippedRight: false, pageScrolls: false });
      await dialog(page).screenshot({ path: evidencePath(`agent-access/${theme}-compact.png`) });
    });
  }
});

test.describe('real pixels and the real save path', () => {
  // The browser keeps only 250 resource-timing entries by default and this
  // application loads thousands of modules, so the entry for the module seam
  // would otherwise be dropped. The buffer must be enlarged before any load.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(50_000);
    });
  });

  /**
   * Drive the control protocol in-page against the production modules. Returns
   * helpers by name so each test states what it does, not how it connects.
   */
  async function attach(page: Page, grants: string[], requireApproval = false) {
    await page.evaluate(
      async ({ grants: g, requireApproval: ra }) => {
        const url = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((name) => /\/automation\/liveEditor\.ts(\?|$)/.test(name));
        if (!url) throw new Error('the live editor seam was not loaded by the application');
        const seam = await import(/* @vite-ignore */ url);
        const controller = await seam.loadAutomationController();
        controller.setCredential('browser-run-credential');
        controller.setPolicy({ enabled: true, grants: g, requireApproval: ra });
        const connect = async (name: string) => {
          const opened = controller.openConnection('ipc');
          if (!opened.ok) throw new Error(opened.message);
          const connection = opened.connection;
          let next = 0;
          const rpc = async (method: string, params: unknown) => {
            next += 1;
            const line = await connection.handleLine(
              JSON.stringify({ jsonrpc: '2.0', id: next, method, params }),
            );
            return line === null ? null : JSON.parse(line);
          };
          const hello = await rpc('session.hello', {
            credential: 'browser-run-credential',
            client: { name, version: '1' },
            protocolVersions: ['varve.control/1'],
          });
          if (hello.error) throw new Error(hello.error.message);
          return rpc;
        };
        // A connection answers its requests in order, so a request held for a
        // person's approval blocks the ones behind it. A second connection is
        // how a client reads while one of its changes is waiting.
        const w = window as unknown as Record<string, unknown>;
        w.__rpc = await connect('playwright');
        w.__rpcRead = await connect('playwright-reader');
      },
      { grants, requireApproval },
    );
  }

  /** Run a command on the second connection, which is never the one holding an approval. */
  const read = (page: Page, command: string, args: unknown) =>
    page.evaluate(
      async ({ command: c, args: a }) => {
        const rpc = (window as unknown as { __rpcRead: (m: string, p: unknown) => Promise<any> })
          .__rpcRead;
        return rpc('command.execute', { command: c, args: a });
      },
      { command, args },
    );

  /** Identify every open <dialog>, so "the save opened nothing" is a before/after comparison. */
  const openDialogs = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('dialog[open]')].map(
        (d) => `${d.className}|${d.getAttribute('aria-label') ?? ''}|${d.id}`,
      ),
    );

  const execute = (page: Page, command: string, args: unknown) =>
    page.evaluate(
      async ({ command: c, args: a }) => {
        const rpc = (window as unknown as { __rpc: (m: string, p: unknown) => Promise<any> }).__rpc;
        return rpc('command.execute', { command: c, args: a });
      },
      { command, args },
    );

  test('captures a created rectangle through the export pipeline, pixel for pixel', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit', 'capture']);

    const created = await execute(page, 'varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      fill: '#14b8a6',
    });
    expect(created.result.outcome).toBe('applied');
    const id = created.result.created[0] as string;
    const revisionAfterEdit = created.result.revision.after as number;

    const captured = await execute(page, 'varve.capture.node', {
      nodeId: id,
      maxDimension: 240,
      background: 'white',
    });
    expect(captured.result.outcome, JSON.stringify(captured.result.error)).toBe('applied');
    const out = captured.result.output;
    expect(out).toMatchObject({ kind: 'document-pixels', nodeId: id, complete: true });
    expect(out.revision).toBe(revisionAfterEdit);
    expect(out.image.mimeType).toBe('image/png');
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(240);
    // The aspect ratio of the node survives: 2:1.
    expect(out.width / out.height).toBeCloseTo(2, 1);
    // The mapping from pixels to the document is stated.
    expect(out.scale).toBeGreaterThan(0);
    expect(out.bounds.w * out.scale).toBeCloseTo(out.width, 0);

    // Decode the actual PNG and read real pixels: the centre is the fill colour.
    const sampled = await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
      return {
        width: bitmap.width,
        height: bitmap.height,
        centre: px(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)),
      };
    }, out.image.data as string);
    expect(sampled.width).toBe(out.width);
    expect(sampled.height).toBe(out.height);
    const [r, g, b, a] = sampled.centre as number[];
    expect(Math.abs((r ?? 0) - 0x14)).toBeLessThanOrEqual(2);
    expect(Math.abs((g ?? 0) - 0xb8)).toBeLessThanOrEqual(2);
    expect(Math.abs((b ?? 0) - 0xa6)).toBeLessThanOrEqual(2);
    expect(a).toBe(255);

    // Keep the image for a person (or a model) to look at.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      evidencePath('agent-access/captured-rect.png'),
      Buffer.from(out.image.data as string, 'base64'),
    );
  });

  test('shows a held change and applies it only when Approve is clicked', async ({ page }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit'], true);

    // The agent asks; the request waits for a person.
    await page.evaluate(() => {
      const rpc = (window as unknown as { __rpc: (m: string, p: unknown) => Promise<any> }).__rpc;
      (window as unknown as { __held: Promise<any> }).__held = rpc('command.execute', {
        command: 'varve.node.create',
        args: { kind: 'rect', x: 5, y: 6, width: 70, height: 40, fill: '#7c3aed' },
      });
    });
    const listShapes = async () => {
      const out = await read(page, 'varve.node.list', { kinds: ['shape'], limit: 50 });
      return out.result.output.nodes.length as number;
    };

    await openAgentAccess(page);
    const approvals = page.getByRole('region', { name: 'Changes waiting for your approval' });
    await expect(approvals).toBeVisible();
    await expect(approvals).toContainText('wants to run');
    await expect(approvals).toContainText(/Create/);
    // Connected-agent list names the client and offers Disconnect.
    const clients = page.getByRole('region', { name: 'Connected agents' });
    await expect(clients).toContainText('playwright');
    await expect(page.getByRole('status', { name: 'Agent access status' })).toBeVisible();

    // Nothing has been applied while it waits.
    expect(await listShapes()).toBe(0);
    // The dialog scrolls, so bring the thing being shown into the picture.
    await approvals.scrollIntoViewIfNeeded();
    await dialog(page).screenshot({ path: evidencePath('agent-access/held-approval.png') });

    // A real pointer click, on the real button.
    await page.getByRole('button', { name: 'Approve' }).click();
    const result = await page.evaluate(
      () => (window as unknown as { __held: Promise<any> }).__held,
    );
    expect(result.result.outcome).toBe('applied');
    expect(await listShapes()).toBe(1);
    await expect(approvals).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Recent agent activity' })).toContainText(
      'applied',
    );
    await page.getByRole('region', { name: 'Recent agent activity' }).scrollIntoViewIfNeeded();
    await dialog(page).screenshot({ path: evidencePath('agent-access/after-approval.png') });
  });

  test('a declined change is refused and nothing is created', async ({ page }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit'], true);
    await page.evaluate(() => {
      const rpc = (window as unknown as { __rpc: (m: string, p: unknown) => Promise<any> }).__rpc;
      (window as unknown as { __held: Promise<any> }).__held = rpc('command.execute', {
        command: 'varve.node.create',
        args: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
      });
    });
    await openAgentAccess(page);
    await page.getByRole('button', { name: 'Decline' }).click();
    const result = await page.evaluate(
      () => (window as unknown as { __held: Promise<any> }).__held,
    );
    expect(result.result.outcome).toBe('rejected');
    expect(result.result.error.code).toBe('PERMISSION_DENIED');
    const out = await read(page, 'varve.node.list', { kinds: ['shape'], limit: 50 });
    expect(out.result.output.nodes).toHaveLength(0);
  });

  test('a capture names the revision it rendered, even if the document moves on', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit', 'capture']);
    const created = await execute(page, 'varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const id = created.result.created[0] as string;
    const first = await execute(page, 'varve.capture.node', { nodeId: id });
    await execute(page, 'varve.node.set', { nodeIds: [id], fill: '#ff0000' });
    const second = await execute(page, 'varve.capture.node', { nodeId: id });
    expect(second.result.output.revision).toBeGreaterThan(first.result.output.revision);
    expect(second.result.output.image.data).not.toBe(first.result.output.image.data);
  });

  test('refuses a capture without the permission', async ({ page }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit', 'export']);
    const created = await execute(page, 'varve.node.create', {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const id = created.result.created[0] as string;
    const noCapture = await execute(page, 'varve.capture.node', { nodeId: id });
    expect(noCapture.result.error.code).toBe('PERMISSION_DENIED');
  });

  test('saves a document created from Home to the Library the person chose, without a dialog', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await attach(page, ['read', 'edit', 'export']);
    await execute(page, 'varve.node.create', { kind: 'rect', x: 0, y: 0, width: 10, height: 10 });
    const native: string[] = [];
    page.on('dialog', (d) => native.push(d.type()));
    const dialogsBefore = await openDialogs(page);
    const save = await execute(page, 'varve.document.save', {});
    expect(save.result.outcome, JSON.stringify(save.result.error)).toBe('applied');
    // A document made from the Home screen already lives in the Varve Library.
    expect(save.result.output.path).toMatch(/^varve-library:/);
    expect(save.result.durable.saved).toBe(true);
    // No browser dialog, and no application dialog appeared because of the save.
    expect(native).toEqual([]);
    expect(await openDialogs(page)).toEqual(dialogsBefore);
  });

  test('refuses to save a tab nobody has saved, and opens no dialog', async ({ page }) => {
    await navigateToEditor(page);
    // File > New makes a fresh tab with no destination.
    await page.keyboard.press('Control+n');
    await expect(page.locator('.editor-shell')).toBeVisible();
    await page.waitForTimeout(500);
    await attach(page, ['read', 'edit', 'export']);
    await execute(page, 'varve.node.create', { kind: 'rect', x: 0, y: 0, width: 10, height: 10 });

    const native: string[] = [];
    page.on('dialog', (d) => native.push(d.type()));
    // Ctrl+N may leave its own dialog open; what matters is that the save adds none.
    const dialogsBefore = await openDialogs(page);
    const save = await execute(page, 'varve.document.save', {});
    expect(save.result.outcome).toBe('rejected');
    expect(save.result.error.code).toBe('UNAVAILABLE');
    expect(save.result.error.hint).toContain('Nothing was written');
    expect(native).toEqual([]);
    expect(await openDialogs(page)).toEqual(dialogsBefore);
  });
});
