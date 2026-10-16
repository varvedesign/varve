import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

interface CorpusEntry {
  id: string;
  category: string;
  text: string;
  options?: {
    writingMode?: string;
    textOrientation?: string;
    combineDigits?: boolean;
  };
}

interface CorpusManifest {
  manifestVersion: number;
  description: string;
  entries: CorpusEntry[];
}

interface CorpusResult {
  id: string;
  category: string;
  status: 'completed' | 'failed';
  ms: number;
  inkPixels: number;
  roundTripBytes: number;
  textPreserved: boolean;
  error?: string;
}

interface CorpusReport {
  manifestDigest: string;
  manifestEntries: number;
  attempted: number;
  completed: number;
  failed: number;
  results: CorpusResult[];
}

const MANIFEST_PATH = 'tests/e2e/fixtures/text-corpus/manifest.json';
const REPORT_ROOT = 'reports/text-corpus';
/**
 * Run-isolated output directory. `playwright.config.ts` derives
 * `VARVE_E2E_OUTPUT_DIR` from PID and port precisely so concurrent agents
 * never overwrite each other's artifacts; a fixed `results.json` would defeat
 * that and let two corpus runs (or a corpus run and any other lane) clobber one
 * another's evidence. The fallback covers invoking this file directly.
 */
const runOutputDir = process.env.VARVE_E2E_OUTPUT_DIR ?? `run-${process.pid}`;
const REPORT_DIR = join(REPORT_ROOT, runOutputDir);
const MIN_INK_PIXELS = 40;

/**
 * Varve-native robustness corpus over real application entry points (the
 * "Varve-native fixtures" lane — deliberately not a PDF corpus, which cannot
 * prove native text authoring). Per entry, through the editor context:
 *
 *   loadDocument(pristine) -> createTextNodeAt -> writing-mode/rich options
 *   -> live compositor raster (ink pixels) -> serializeDocument
 *   -> loadDocument (save/reopen) -> semantic text equality
 *
 * Results land in `reports/text-corpus/<run-id>/results.json`, where the run id
 * is `VARVE_E2E_OUTPUT_DIR` from `playwright.config.ts` so concurrent runs stay
 * isolated, together with the manifest SHA-256 digest and explicit
 * attempted/completed/failed counts. A completed entry means: painted,
 * reopened, and its logical source
 * preserved exactly.
 */
test.describe('Varve-native text corpus', () => {
  const manifest: CorpusManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const manifestDigest = createHash('sha256').update(readFileSync(MANIFEST_PATH)).digest('hex');

  async function editorCall(
    page: import('@playwright/test').Page,
    op: 'serialize' | 'load' | 'create' | 'nodeText' | 'locateTextNode' | 'applyOptions',
    payload?: unknown,
  ): Promise<unknown> {
    return page.evaluate(
      ({ op, payload }) => {
        const root = document.getElementById('root')!;
        const key = Object.keys(root).find(
          (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
        )!;
        function find(fiber: unknown): Record<string, unknown> | null {
          if (!fiber || typeof fiber !== 'object') return null;
          const record = fiber as Record<string, unknown>;
          const value = (record.memoizedProps as Record<string, unknown> | undefined)?.value as
            | Record<string, unknown>
            | undefined;
          if (value && typeof value.serializeDocument === 'function') return value;
          return find(record.child) ?? find(record.sibling);
        }
        const editor = find((root as unknown as Record<string, unknown>)[key]);
        if (!editor) throw new Error('editor context not found');

        if (op === 'serialize') {
          return (editor.serializeDocument as () => string)();
        }
        if (op === 'load') {
          (editor.loadDocument as (json: string) => void)(payload as string);
          return null;
        }
        if (op === 'nodeText') {
          // Ids may be regenerated on load; scan the reopened document for
          // its single text node instead of trusting the pre-load id.
          const parsed = JSON.parse((editor.serializeDocument as () => string)()) as {
            nodes?: Record<string, { kind: string; text?: string }>;
          };
          const textNode = Object.values(parsed.nodes ?? {}).find((n) => n.kind === 'text');
          return textNode?.text ?? null;
        }
        if (op === 'locateTextNode') {
          // React has committed by now (the caller waited a frame); prefer
          // the selection, falling back to scanning the document nodes.
          const selected = (editor.selectedNodes as () => Array<{ id: string; kind: string }>)();
          const selectedText = selected.find((n) => n.kind === 'text');
          if (selectedText) return selectedText.id;
          const parsed = JSON.parse((editor.serializeDocument as () => string)()) as {
            nodes?: Record<string, { kind: string; text?: string }>;
          };
          const scan = Object.entries(parsed.nodes ?? {}).find(
            ([, n]) => n.kind === 'text' && typeof n.text === 'string',
          );
          return scan?.[0] ?? null;
        }
        if (op === 'applyOptions') {
          const { id, entry } = payload as { id: string; entry: CorpusEntry };
          const updateNode = editor.updateNode as (
            id: string,
            updater: (n: object) => object,
          ) => void;
          if (entry.options?.writingMode || entry.options?.textOrientation) {
            updateNode(id, (n) => ({
              ...n,
              writingMode: entry.options?.writingMode ?? 'horizontal-tb',
              textOrientation: entry.options?.textOrientation ?? 'mixed',
            }));
          }
          if (entry.options?.combineDigits) {
            // Mark only the digit span combined (tate-chu-yoko), the way an
            // author selects "12" inside 平成12年 — not the whole paragraph.
            const digits = entry.text.match(/\d+/);
            if (!digits || digits.index === undefined) throw new Error('no digits to combine');
            const start = digits.index;
            const end = start + digits[0].length;
            const runs: Array<{ text: string; format?: { textCombineUpright: boolean } }> = [];
            if (start > 0) runs.push({ text: entry.text.slice(0, start) });
            runs.push({ text: entry.text.slice(start, end), format: { textCombineUpright: true } });
            if (end < entry.text.length) runs.push({ text: entry.text.slice(end) });
            updateNode(id, (n) => ({
              ...n,
              richText: { paragraphs: [{ runs }] },
            }));
          }
          return null;
        }
        // op === 'create'
        const { entry } = payload as { entry: CorpusEntry };
        (
          editor.createTextNodeAt as (
            world: { x: number; y: number },
            size?: { w: number; h: number },
            parentId?: string | null,
            text?: string,
          ) => void
        )({ x: 140, y: 100 }, { w: 520, h: 420 }, null, entry.text);
        return null;
      },
      { op, payload },
    );
  }

  async function waitForPaint(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForTimeout(250);
  }

  async function inkPixels(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!canvas) return -1;
      const context = canvas.getContext('2d');
      if (!context) return -1;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 170 && pixels[i + 3]! > 0) count += 1;
      }
      return count;
    });
  }

  test('every corpus entry paints, round-trips, and preserves its source', async ({ page }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });

    const pristine = (await editorCall(page, 'serialize')) as string;

    const results: CorpusResult[] = [];
    for (const entry of manifest.entries) {
      const started = Date.now();
      const result: CorpusResult = {
        id: entry.id,
        category: entry.category,
        status: 'failed',
        ms: 0,
        inkPixels: 0,
        roundTripBytes: 0,
        textPreserved: false,
      };
      try {
        await editorCall(page, 'load', pristine);
        await editorCall(page, 'create', { entry });
        await waitForPaint(page);
        const nodeId = (await editorCall(page, 'locateTextNode')) as string | null;
        if (!nodeId) throw new Error('created text node not found after flush');
        await editorCall(page, 'applyOptions', { id: nodeId, entry });
        await waitForPaint(page);
        result.inkPixels = await inkPixels(page);

        const serialized = (await editorCall(page, 'serialize')) as string;
        result.roundTripBytes = serialized.length;
        await editorCall(page, 'load', serialized);
        await waitForPaint(page);
        const reopenText = await editorCall(page, 'nodeText', nodeId);

        result.textPreserved = reopenText === entry.text;
        result.status =
          result.inkPixels >= MIN_INK_PIXELS && result.textPreserved ? 'completed' : 'failed';
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      }
      result.ms = Date.now() - started;
      results.push(result);
    }

    const report: CorpusReport = {
      manifestDigest,
      manifestEntries: manifest.entries.length,
      attempted: results.length,
      completed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
    mkdirSync(REPORT_DIR, { recursive: true });
    const reportPath = join(REPORT_DIR, 'results.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    // Name the artifact so an operator can find this run's evidence without
    // guessing the run id.
    // eslint-disable-next-line no-console
    console.log(
      `text-corpus: ${report.completed}/${report.attempted} completed, ${report.failed} failed ` +
        `-> ${reportPath} (manifest ${report.manifestDigest.slice(0, 16)}…)`,
    );

    // Non-vacuity: `attempted` and `failed` are both derived from the same
    // array, so an empty or truncated manifest would satisfy `failed === 0`
    // while proving nothing. The denominator is asserted against the manifest
    // itself, which is read from disk rather than derived from the run.
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(report.attempted).toBe(report.manifestEntries);
    expect(report.manifestEntries).toBe(manifest.entries.length);
    expect(report.manifestDigest).toBe(manifestDigest);
    expect(report.failed).toBe(0);
    for (const result of results) {
      expect(result.status, `${result.id} ${result.error ?? ''}`).toBe('completed');
      expect(result.textPreserved, `${result.id} text preservation`).toBe(true);
      expect(result.inkPixels, `${result.id} ink`).toBeGreaterThanOrEqual(MIN_INK_PIXELS);
    }
  });
});
