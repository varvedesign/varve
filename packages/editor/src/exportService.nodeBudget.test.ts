/**
 * Per-node export budget (storytold/pdfcraft #3634).
 *
 * The corpus row says export is cancellable but has no per-node deadline, so a
 * pathological node can hold the whole batch. These tests drive the real
 * executor with a raster renderer that never settles: the batch must report a
 * failed, named node instead of hanging, must not write a file for it, and
 * must still complete a normal node under the same budget.
 */
import { createDocument, type ExportBatch, type ExportJob, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const raster = vi.hoisted(() => vi.fn());

vi.mock('./components/SpecPanel/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/SpecPanel/export')>();
  return { ...actual, exportNodeAsRaster: raster };
});

import { ExportService } from './exportService';

function pngBatch(nodeId = 'n1'): ExportBatch {
  const job: ExportJob = {
    presetId: 'p1',
    nodeId,
    nodeName: 'Logo',
    format: 'png',
    fileName: 'Logo.png',
    dimensions: { w: 640, h: 480 },
    estimatedSize: 1024,
    status: 'pending',
  };
  return {
    jobs: [job],
    destinationFolder: null,
    filenameTemplate: '{name}.{ext}',
    folderRule: 'flat',
  };
}

const engine = {} as never;

function documentWithRect() {
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
  return { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
}

describe('ExportService per-node budget', () => {
  afterEach(() => {
    raster.mockReset();
  });

  it('fails a node that exceeds its budget without writing it', async () => {
    // Never settles: only the deadline can end this node.
    raster.mockImplementation(() => new Promise(() => undefined));
    const saveFile = vi.fn(async () => '/exports/Logo.png');

    const report = await ExportService.run(pngBatch(), {
      document: documentWithRect(),
      engine,
      saveFile,
      nodeBudgetMs: 25,
    });

    expect(report.failureCount).toBe(1);
    expect(report.successCount).toBe(0);
    expect(report.files[0]).toMatchObject({ fileName: 'Logo.png', status: 'failed' });
    expect(report.files[0]?.error).toContain('timed out after 25 ms');
    expect(report.files[0]?.error).toContain('Logo.png');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('completes a node that finishes inside its budget', async () => {
    raster.mockResolvedValue({
      blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      warnings: [],
      resourceFailures: [],
    });
    const saveFile = vi.fn(async () => '/exports/Logo.png');

    const report = await ExportService.run(pngBatch(), {
      document: documentWithRect(),
      engine,
      saveFile,
      nodeBudgetMs: 5_000,
    });

    expect(report.failureCount).toBe(0);
    expect(report.successCount).toBe(1);
    expect(saveFile).toHaveBeenCalledOnce();
  });

  it('keeps a generous default budget so legitimately slow exports finish', async () => {
    // 60 ms of real work is slow for a test but nothing against the 5-minute
    // default; it must not be misreported as pathological.
    raster.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
                warnings: [],
                resourceFailures: [],
              }),
            60,
          ),
        ),
    );

    const report = await ExportService.run(pngBatch(), {
      document: documentWithRect(),
      engine,
      saveFile: async () => '/exports/Logo.png',
    });

    expect(report.successCount).toBe(1);
    expect(report.files[0]?.error).toBeUndefined();
  });

  it('still treats a user cancellation as cancellation, not a node failure', async () => {
    raster.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const run = ExportService.run(
      pngBatch(),
      {
        document: documentWithRect(),
        engine,
        saveFile: async () => '/exports/Logo.png',
        nodeBudgetMs: 60_000,
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
