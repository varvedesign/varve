/**
 * Saving immediately after typing must write every character the textarea shows.
 *
 * Evidence: storytold/pdfcraft #811 ("save and close ignore typing in an open
 * paragraph") and #166 ("Save omits AcroForm text while the field remains
 * focused"). The transferable defect is an editing surface that coalesces
 * typed input for render cost and then exposes no way for the persistence path
 * to drain it. A save taken inside the coalescing window writes a document
 * missing the tail of the paragraph, clears dirty state, and the loss is
 * silent — the user only finds out when the file is reopened.
 *
 * The coalescing itself is deliberate here too (`TextEditOverlay` documents
 * why a keystroke cannot replay a large document), so the fix is a drain at
 * the observation points, not a synchronous write per keystroke. This spec
 * pins the observable consequence: whatever the textarea shows when Save is
 * pressed is in the bytes that reach the destination.
 *
 * The browser save route is stubbed the same way `save/save-flow.spec.ts`
 * stubs it, so the written payload can be read back and parsed with the real
 * codec instead of inferred from the UI.
 */
import { expect, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

interface SaveProbeWindow {
  __varveWritten?: string | null;
  __varveWriteCount?: number;
}

async function installSavePickerStub(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as SaveProbeWindow & Record<string, unknown>;
    win.__varveWritten = null;
    win.__varveWriteCount = 0;
    let handleName = 'draft.varve';
    Object.defineProperty(win, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async (opts: { suggestedName?: string }) => {
        handleName = opts.suggestedName ?? handleName;
        return {
          name: handleName,
          queryPermission: async () => 'granted' as PermissionState,
          createWritable: async () => ({
            write: async (data: unknown) => {
              win.__varveWritten = typeof data === 'string' ? data : String(data);
              win.__varveWriteCount = (win.__varveWriteCount ?? 0) + 1;
            },
            close: async () => undefined,
          }),
        };
      },
    });
  });
}

async function startUnboundDocument(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: /^File$/ })
    .click();
  await page.locator('.editor-menubar__menu-item').filter({ hasText: /^New/ }).first().click();
  await expect(page.locator('.save-status')).toHaveText('Not saved');
}

async function writtenDocument(page: import('@playwright/test').Page): Promise<string> {
  await expect
    .poll(async () => page.evaluate(() => (window as SaveProbeWindow).__varveWriteCount ?? 0), {
      timeout: 15000,
      message: 'the save never reached the destination',
    })
    .toBeGreaterThan(0);
  const payload = await page.evaluate(() => (window as SaveProbeWindow).__varveWritten ?? null);
  expect(payload).not.toBeNull();
  return payload as string;
}

/** Text nodes in the saved document, in the order the file stores them. */
function savedTextOf(json: string): string[] {
  const parsed = JSON.parse(json) as { nodes?: Record<string, { kind?: string; text?: string }> };
  return Object.values(parsed.nodes ?? {})
    .filter((node) => node.kind === 'text')
    .map((node) => node.text ?? '');
}

test.describe('Text draft is flushed into the saved bytes', () => {
  test.beforeEach(async ({ page }) => {
    await installSavePickerStub(page);
    await navigateToCleanEditor(page);
    await startUnboundDocument(page);
  });

  test('a save taken while typing is still in the coalescing window writes the whole phrase', async ({
    page,
  }, testInfo) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const at = { x: (box?.x ?? 0) + 260, y: (box?.y ?? 0) + 220 };

    await page.keyboard.press('t');
    await page.mouse.click(at.x, at.y);
    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Typed with a small inter-key delay so the last keystrokes are still
    // inside the overlay's coalescing window when Save is pressed: the
    // textarea shows text the document does not have yet. The phrase is long
    // enough that a mistaken per-keystroke flush cannot be what makes it pass.
    const phrase = 'Every character reaches the file';
    await textarea.pressSequentially(phrase, { delay: 4 });
    await expect(textarea).toHaveValue(phrase);
    await page.screenshot({ path: testInfo.outputPath('text-draft-before-save.png') });

    await page.keyboard.press(mod('s'));

    const text = savedTextOf(await writtenDocument(page));
    expect(text.join('\n')).toContain(phrase);
    // The save must not end the user's editing session either.
    await expect(textarea).toBeVisible();
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  });

  test('closing the document immediately after typing still counts the draft as unsaved work', async ({
    page,
  }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    const at = { x: (box?.x ?? 0) + 320, y: (box?.y ?? 0) + 260 };

    await page.keyboard.press('t');
    await page.mouse.click(at.x, at.y);
    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await expect(textarea).toBeVisible({ timeout: 10000 });
    const phrase = 'Unsaved work must be visible';
    await textarea.pressSequentially(phrase, { delay: 4 });

    // Close the tab while the draft is buffered. A document whose only
    // outstanding change is a held-back keystroke must not be treated as
    // clean, or quitting silently discards it.
    await page
      .getByRole('tab', { name: /Untitled.*unsaved/i })
      .getByRole('button', { name: /^Close / })
      .click();

    const dialog = page.locator('dialog[open], [role="dialog"][data-state="open"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText(/unsaved|save/i);
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('textbox', { name: 'Text content' })).toHaveValue(phrase);
  });
});
