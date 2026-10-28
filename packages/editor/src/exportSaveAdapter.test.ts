import type { Platform } from '@varve/platform';
import type { ExportJob } from '@varve/scene';
import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  createBufferedExportArchive,
  createExportFolderSaveFile,
  createExportSaveFile,
  extensionForExport,
} from './exportSaveAdapter';

function job(format: ExportJob['format'], fileName = 'Layer.export'): ExportJob {
  return {
    presetId: 'preset-1',
    nodeId: 'node-1',
    nodeName: 'Layer',
    format,
    fileName,
    dimensions: { w: 100, h: 80 },
    estimatedSize: 1024,
    status: 'pending',
  };
}

function platformWithSave(saveBinaryFile: Platform['saveBinaryFile']): Platform {
  return {
    kind: 'tauri',
    saveBinaryFile,
  } as unknown as Platform;
}

describe('export save adapter', () => {
  it('derives SVG extension from the export job instead of MIME fallback', () => {
    expect(extensionForExport('Logo.bin', 'application/octet-stream', job('svg'))).toBe('.svg');
  });

  it('refuses to derive an extension from a trailing dot', () => {
    // `Logo.` must not produce `"."` as an extension.
    expect(extensionForExport('Logo.', 'application/octet-stream')).toBe('.bin');
  });

  it('derives the extension from the filename only as a last resort', () => {
    expect(extensionForExport('Logo.svg', 'application/octet-stream')).toBe('.svg');
  });

  it('keeps a sibling file’s own code extension inside a multi-file deliverable', () => {
    // A CSS Module written next to `Card.tsx` must not be renamed
    // `Card.module.css.tsx`, which is what applying the job's format
    // extension to every output produced before.
    const cssModule = extensionForExport(
      'Card.module.css',
      'text/css',
      job('react-cssmodules', 'Card.tsx'),
    );
    expect(cssModule).toBe('.css');

    const component = extensionForExport(
      'Card.tsx',
      'text/tsx',
      job('react-cssmodules', 'Card.tsx'),
    );
    expect(component).toBe('.tsx');
  });

  it('saves through the active binary-aware platform with the derived extension', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>(async () => '/tmp/Logo.svg');
    const saveFile = createExportSaveFile(platformWithSave(saveBinaryFile));

    const saved = await saveFile?.(
      'Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg', 'Logo.svg'),
    );

    expect(saved).toBe('/tmp/Logo.svg');
    expect(saveBinaryFile).toHaveBeenCalledOnce();
    const [fileName, bytes, mimeType, extension] = saveBinaryFile.mock.calls[0]!;
    expect(fileName).toBe('Logo.svg');
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(bytes.byteLength).toBe(7);
    expect(mimeType).toBe('image/svg+xml');
    expect(extension).toBe('.svg');
  });

  it('delivers a browser batch as one ZIP with safe unique entry names', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>(async () => 'Design-exports.zip');
    const platform = { kind: 'web', saveBinaryFile } as unknown as Platform;
    const archive = createBufferedExportArchive(platform);

    await archive.saveFile(
      '../Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg'),
    );
    await archive.saveFile(
      'Logo.svg',
      new TextEncoder().encode('<svg id="two" />'),
      'image/svg+xml',
      job('svg'),
    );
    const saved = await archive.flush('Design-exports');

    expect(saved).toBe('Design-exports.zip');
    expect(archive.fileCount()).toBe(2);
    expect(saveBinaryFile).toHaveBeenCalledOnce();
    const [fileName, bytes, mimeType, extension] = saveBinaryFile.mock.calls[0]!;
    expect(fileName).toBe('Design-exports.zip');
    expect(bytes.byteLength).toBeGreaterThan(20);
    expect(Object.keys(unzipSync(bytes))).toEqual(['Logo.svg', 'Logo-2.svg']);
    expect(mimeType).toBe('application/zip');
    expect(extension).toBe('.zip');
  });

  it('does not create an empty archive after a fully failed batch', async () => {
    const saveBinaryFile = vi.fn<Platform['saveBinaryFile']>();
    const platform = { kind: 'web', saveBinaryFile } as unknown as Platform;
    const archive = createBufferedExportArchive(platform);

    expect(await archive.flush('empty')).toBeNull();
    expect(saveBinaryFile).not.toHaveBeenCalled();
  });

  it('writes desktop batch entries beneath one chosen folder', async () => {
    const writeBinaryFileToFolder = vi.fn<Platform['writeBinaryFileToFolder']>(
      async () => '/exports/Logo.svg',
    );
    const fileExists = vi.fn<Platform['fileExists']>(async () => false);
    const platform = { kind: 'tauri', fileExists, writeBinaryFileToFolder } as unknown as Platform;
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    const saved = await saveFile(
      '../Logo.svg',
      new TextEncoder().encode('<svg />'),
      'image/svg+xml',
      job('svg'),
    );

    expect(saved).toBe('/exports/Logo.svg');
    expect(writeBinaryFileToFolder).toHaveBeenCalledOnce();
    const [folder, relativePath, bytes] = writeBinaryFileToFolder.mock.calls[0]!;
    expect(folder).toBe('/exports');
    expect(relativePath).toBe('Logo.svg');
    expect(ArrayBuffer.isView(bytes)).toBe(true);
  });
});

interface RecordingFolderPlatform {
  platform: Platform;
  writes: Array<{ folder: string; relativePath: string }>;
  files: Set<string>;
}

/** Fake desktop platform whose "disk" is a set of absolute paths. */
function recordingFolderPlatform(existing: string[] = []): RecordingFolderPlatform {
  const files = new Set(existing);
  const writes: Array<{ folder: string; relativePath: string }> = [];
  const platform = {
    kind: 'tauri',
    fileExists: vi.fn(async (path: string) => files.has(path)),
    writeBinaryFileToFolder: vi.fn(async (folder: string, relativePath: string) => {
      writes.push({ folder, relativePath });
      const target = `${folder.replace(/\/+$/, '')}/${relativePath}`;
      files.add(target);
      return target;
    }),
  } as unknown as Platform;
  return { platform, writes, files };
}

describe('folder export destination conflicts', () => {
  it('never replaces an existing file: writes the next free name and reports it', async () => {
    const { platform, writes } = recordingFolderPlatform(['/exports/Logo.svg']);
    const saveFile = createExportFolderSaveFile(platform, '/exports');
    const exportJob = job('svg', 'Logo.svg');

    const saved = await saveFile(
      'Logo.svg',
      new TextEncoder().encode('<svg id="new" />'),
      'image/svg+xml',
      exportJob,
    );

    expect(writes).toEqual([{ folder: '/exports', relativePath: 'Logo-2.svg' }]);
    expect(saved).toBe('/exports/Logo-2.svg');
    // The results report is built from the job name, so it must show the file
    // that actually landed on disk.
    expect(exportJob.fileName).toBe('Logo-2.svg');
  });

  it('skips every consecutively occupied suffix', async () => {
    const { platform, writes } = recordingFolderPlatform([
      '/exports/Logo.svg',
      '/exports/Logo-2.svg',
      '/exports/Logo-3.svg',
    ]);
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    await saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', job('svg', 'Logo.svg'));

    expect(writes[0]?.relativePath).toBe('Logo-4.svg');
  });

  it('keeps the requested name when the destination folder is free', async () => {
    const { platform, writes } = recordingFolderPlatform();
    const saveFile = createExportFolderSaveFile(platform, '/exports/');
    const exportJob = job('svg', 'Logo.svg');

    await saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', exportJob);

    expect(writes[0]?.relativePath).toBe('Logo.svg');
    expect(exportJob.fileName).toBe('Logo.svg');
    // The probe joins the portable entry to the folder on an absolute path.
    expect(platform.fileExists).toHaveBeenCalledWith('/exports/Logo.svg');
  });

  it('does not retitle a job from one of its sibling files', async () => {
    const { platform } = recordingFolderPlatform(['/exports/Card.module.css']);
    const saveFile = createExportFolderSaveFile(platform, '/exports');
    const exportJob = job('react-cssmodules', 'Card.tsx');

    await saveFile('Card.module.css', new Uint8Array([1]), 'text/css', exportJob);

    expect(exportJob.fileName).toBe('Card.tsx');
  });

  it('fails closed instead of writing when the existence probe fails', async () => {
    const writeBinaryFileToFolder = vi.fn<Platform['writeBinaryFileToFolder']>(
      async () => '/exports/Logo.svg',
    );
    const platform = {
      kind: 'tauri',
      fileExists: vi.fn(async () => {
        throw new Error('probe unavailable');
      }),
      writeBinaryFileToFolder,
    } as unknown as Platform;
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    await expect(
      saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', job('svg', 'Logo.svg')),
    ).rejects.toThrow(/Could not verify whether "Logo.svg" already exists/);
    expect(writeBinaryFileToFolder).not.toHaveBeenCalled();
  });

  it('fails closed when a later suffix probe fails instead of overwriting it', async () => {
    const writeBinaryFileToFolder = vi.fn<Platform['writeBinaryFileToFolder']>(
      async () => '/exports/Logo-2.svg',
    );
    const platform = {
      kind: 'tauri',
      fileExists: vi.fn(async (path: string) => {
        if (path === '/exports/Logo.svg') return true;
        throw new Error('probe unavailable mid-loop');
      }),
      writeBinaryFileToFolder,
    } as unknown as Platform;
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    await expect(
      saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', job('svg', 'Logo.svg')),
    ).rejects.toThrow(/Could not verify whether "Logo-2.svg" already exists/);
    expect(writeBinaryFileToFolder).not.toHaveBeenCalled();
  });

  it('probes absolute paths for POSIX roots, trailing separators and Windows folders', async () => {
    const probed: string[] = [];
    const platform = {
      kind: 'tauri',
      fileExists: vi.fn(async (path: string) => {
        probed.push(path);
        return false;
      }),
      writeBinaryFileToFolder: vi.fn(async (folder: string, entry: string) => `${folder}/${entry}`),
    } as unknown as Platform;

    for (const folder of ['/', '/exports/', 'C:\\Users\\me\\exports']) {
      const saveFile = createExportFolderSaveFile(platform, folder);
      await saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', job('svg', 'Logo.svg'));
    }

    expect(probed).toEqual(['/Logo.svg', '/exports/Logo.svg', 'C:\\Users\\me\\exports/Logo.svg']);
  });

  it('refuses after the probe budget is exhausted', async () => {
    const platform = {
      kind: 'tauri',
      fileExists: vi.fn(async () => true),
      writeBinaryFileToFolder: vi.fn(async () => '/exports/Logo.svg'),
    } as unknown as Platform;
    const saveFile = createExportFolderSaveFile(platform, '/exports');

    await expect(
      saveFile('Logo.svg', new Uint8Array([1]), 'image/svg+xml', job('svg', 'Logo.svg')),
    ).rejects.toThrow(/No unused file name was available/);
    expect(platform.writeBinaryFileToFolder).not.toHaveBeenCalled();
  });
});
