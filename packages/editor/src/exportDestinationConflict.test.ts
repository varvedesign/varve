/**
 * Destination-conflict regression: a desktop folder export must never replace a
 * file that is already in the chosen folder.
 *
 * Before the fix, `createExportFolderSaveFile` forwarded the planned name to
 * `write_binary_file_to_folder`, and the native atomic write renamed over the
 * target unconditionally. Re-exporting the same artwork silently destroyed the
 * previous export. The fix probes the destination and writes the next free name
 * (`Logo-2.svg`), and the results report names the file that actually landed.
 *
 * LightCraft issue #93 / #1405 report the same failure class in a sibling
 * application: export writing over an existing file with no conflict
 * resolution. Varve's declared batch `conflictPolicy` is `rename`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Platform } from '@varve/platform';
import {
  createDocument,
  type Document,
  type ExportBatch,
  type ExportJob,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { createExportFolderSaveFile } from './exportSaveAdapter';
import { ExportService } from './exportService';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'varve-export-conflict-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Desktop-like platform backed by the real filesystem. */
function desktopPlatform(): Platform {
  return {
    kind: 'tauri',
    fileExists: async (path: string) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    },
    writeBinaryFileToFolder: async (folder: string, relativePath: string, data: Uint8Array) => {
      const target = join(folder, relativePath);
      writeFileSync(target, data);
      return target;
    },
  } as unknown as Platform;
}

function logoJob(fileName: string): ExportJob {
  return {
    presetId: 'preset-1',
    nodeId: 'n1',
    nodeName: 'Logo',
    format: 'svg',
    fileName,
    dimensions: { w: 20, h: 10 },
    estimatedSize: 1024,
    status: 'pending',
  };
}

function svgBatch(jobs: ExportJob[], destinationFolder: string): ExportBatch {
  return {
    jobs,
    destinationFolder,
    filenameTemplate: '{name}.{ext}',
    folderRule: 'flat',
  };
}

function logoDocument(): Document {
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Logo' });
  return { ...createDocument('Doc', true), rootChildren: ['n1'], nodes: { n1: node } };
}

describe('desktop folder export destination conflicts', () => {
  it('keeps the existing file and writes the next free name', async () => {
    const folder = makeTempDir();
    const existing = join(folder, 'Logo.svg');
    writeFileSync(existing, 'previous export');

    const report = await ExportService.run(
      svgBatch([logoJob('Logo.svg')], folder),
      { document: logoDocument(), saveFile: createExportFolderSaveFile(desktopPlatform(), folder) },
      undefined,
      'tauri',
    );

    expect(report.successCount).toBe(1);
    expect(report.files[0]?.fileName).toBe('Logo-2.svg');
    expect(report.files[0]?.savedPath).toBe(join(folder, 'Logo-2.svg'));
    // The previous export is untouched: no silent data loss.
    expect(readFileSync(existing, 'utf8')).toBe('previous export');
    expect(readFileSync(join(folder, 'Logo-2.svg'), 'utf8')).toContain('<svg');
  });

  it('keeps both outputs when a planned name is already taken on disk', async () => {
    const folder = makeTempDir();
    writeFileSync(join(folder, 'Logo.svg'), 'previous export');

    const report = await ExportService.run(
      svgBatch([logoJob('Logo.svg'), logoJob('Logo-2.svg')], folder),
      { document: logoDocument(), saveFile: createExportFolderSaveFile(desktopPlatform(), folder) },
      undefined,
      'tauri',
    );

    expect(report.successCount).toBe(2);
    const names = report.files.map((file) => file.fileName).sort();
    expect(names).toEqual(['Logo-2-2.svg', 'Logo-2.svg']);
    expect(readFileSync(join(folder, 'Logo.svg'), 'utf8')).toBe('previous export');
    expect(readFileSync(join(folder, 'Logo-2.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(join(folder, 'Logo-2-2.svg'), 'utf8')).toContain('<svg');
  });

  it('writes the requested name when the folder is free', async () => {
    const folder = makeTempDir();

    const report = await ExportService.run(
      svgBatch([logoJob('Logo.svg')], folder),
      { document: logoDocument(), saveFile: createExportFolderSaveFile(desktopPlatform(), folder) },
      undefined,
      'tauri',
    );

    expect(report.files[0]?.fileName).toBe('Logo.svg');
    expect(readFileSync(join(folder, 'Logo.svg'), 'utf8')).toContain('<svg');
  });

  it('renames a sibling file in a multi-file deliverable without retitling the job', async () => {
    const folder = makeTempDir();
    const existingSibling = join(folder, 'Card.module.css');
    writeFileSync(existingSibling, 'previous stylesheet');
    const exportJob = logoJob('Card.tsx');
    const saveFile = createExportFolderSaveFile(desktopPlatform(), folder);

    await saveFile('Card.module.css', new TextEncoder().encode('.card{}'), 'text/css', exportJob);

    expect(readFileSync(existingSibling, 'utf8')).toBe('previous stylesheet');
    expect(readFileSync(join(folder, 'Card.module-2.css'), 'utf8')).toBe('.card{}');
    // The job identity is its primary file, so a renamed sibling must not
    // change the name reported for the deliverable.
    expect(exportJob.fileName).toBe('Card.tsx');
  });
});
