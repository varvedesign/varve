/** PDFCraft #3923: recovery provenance must never authorize a save target. */
import { expect, type Page, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

interface SaveProbe {
  cancel: boolean;
  suggested: string[];
  writes: string[];
}

type ProbeWindow = Window & { __recoverySave: SaveProbe };

async function libraryDocuments(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('varve-home');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ id: string; json: string | null }>>((resolve, reject) => {
        const tx = db.transaction(['files', 'fileContent'], 'readonly');
        const files = tx.objectStore('files').getAll();
        const contents = tx.objectStore('fileContent').getAll();
        tx.oncomplete = () => {
          const payloads = new Map(
            (contents.result as Array<{ hash: string; json: string }>).map((row) => [
              row.hash,
              row.json,
            ]),
          );
          resolve(
            (files.result as Array<{ entry: { id: string; contentHash?: string }; json?: string }>)
              .map((row) => ({
                id: row.entry.id,
                json: row.json ?? payloads.get(row.entry.contentHash ?? '') ?? null,
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          );
        };
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}

test('a recovered document asks before its first save and never overwrites recorded provenance', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const probe: SaveProbe = { cancel: true, suggested: [], writes: [] };
    (window as unknown as ProbeWindow).__recoverySave = probe;
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async (options: { suggestedName?: string }) => {
        probe.suggested.push(options.suggestedName ?? '');
        if (probe.cancel) throw new DOMException('Cancelled by user', 'AbortError');
        return {
          name: 'chosen-recovery.varve',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async (data: string) => {
              probe.writes.push(data);
            },
            close: async () => undefined,
          }),
        };
      },
    });
  });
  await navigateToEditor(page);
  const before = await libraryDocuments(page);
  const victim = before.find((row) => row.json !== null);
  expect(victim, 'Home-created file must be stored before planting its id').toBeDefined();
  // Ordinary reload of a clean editor finalizes its marker at pagehide. Plant
  // the interrupted-run fixture on Home AFTER that boundary, before the next
  // editor mounts; planting it before reload incorrectly models a clean exit.
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem('strata-clean-shutdown'))).toBe('true');
  // A pre-migration document is ordinary supported input. Keep this fixture
  // data-only: importing the scene barrel here loads browser-only engine code
  // into Playwright's Node test collector rather than exercising the UI codec.
  const recovered = {
    id: 'ff39d8ab-b058-47a6-82cd-d71378fc70df',
    formatVersion: '2.0',
    name: 'Recovered candidate',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  };
  await page.evaluate(
    async ({ documentJson, fileId }) => {
      localStorage.setItem('strata-clean-shutdown', 'false');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('varve-recovery', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('sessions');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put(
            JSON.stringify({
              session: {
                id: 'hostile-destination',
                tabName: 'Recovered candidate',
                timestamp: Date.now(),
                fileId,
                filePath: '/must-not-overwrite/victim.varve',
              },
              document: JSON.parse(documentJson),
            }),
            'recovery_hostile-destination',
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { documentJson: JSON.stringify(recovered), fileId: victim?.id },
  );
  const seededRecovery = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('varve-recovery', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const exists = await new Promise<boolean>((resolve, reject) => {
        const request = db
          .transaction('sessions', 'readonly')
          .objectStore('sessions')
          .get('recovery_hostile-destination');
        request.onsuccess = () => resolve(typeof request.result === 'string');
        request.onerror = () => reject(request.error);
      });
      return { marker: localStorage.getItem('strata-clean-shutdown'), exists };
    } finally {
      db.close();
    }
  });
  expect(
    seededRecovery,
    'The interrupted-run fixture must survive startup before editor mount',
  ).toEqual({
    marker: 'false',
    exists: true,
  });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(\s+design)?$/i })
    .click();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved documents', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Recovered candidate/ })).toBeAttached();
  await recovery.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('Not saved');

  await page.keyboard.press(mod('s'));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as ProbeWindow).__recoverySave.suggested.length),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as ProbeWindow).__recoverySave.writes),
  ).toEqual([]);
  await expect(page.locator('.save-status')).toHaveText('Not saved');
  expect((await libraryDocuments(page)).find((row) => row.id === victim?.id)).toEqual(victim);

  await page.evaluate(() => {
    (window as unknown as ProbeWindow).__recoverySave.cancel = false;
  });
  await page.keyboard.press(mod('s'));
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const saved = await page.evaluate(() => (window as unknown as ProbeWindow).__recoverySave);
  expect(saved.suggested).toEqual(['Recovered candidate.varve', 'Recovered candidate.varve']);
  expect(saved.writes).toHaveLength(1);
  expect(JSON.parse(saved.writes[0] ?? '{}').id).toBe(recovered.id);
  expect((await libraryDocuments(page)).find((row) => row.id === victim?.id)).toEqual(victim);
  await page.screenshot({ path: testInfo.outputPath('recovery-chosen-destination.png') });
});
