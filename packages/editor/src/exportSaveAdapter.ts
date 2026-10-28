/**
 * Export save adapter — bridges ExportService bytes to the active platform.
 *
 * Research basis: MDN File System Access API and Clipboard/File APIs favor
 * binary Blob/Uint8Array flows over text/data-URL round trips for large assets.
 */

import type { Platform } from '@varve/platform';
import type { ExportFormat, ExportJob } from '@varve/scene';
import { appendSuffix, sanitizeSegment } from '@varve/scene/export';
import { zipSync } from 'fflate';
import type { ExportRunContext } from './exportService';

const FORMAT_EXTENSIONS: Partial<Record<ExportFormat, string>> = {
  avif: '.avif',
  flutter: '.dart',
  jpg: '.jpg',
  'pdf-screen': '.pdf',
  'pdf-x1a': '.pdf',
  'pdf-x4': '.pdf',
  png: '.png',
  'react-cssmodules': '.tsx',
  'react-tailwind': '.tsx',
  svg: '.svg',
  'svg-component': '.svg',
  swiftui: '.swift',
  webp: '.webp',
};

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/avif': '.avif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/css': '.css',
  'text/jsx': '.jsx',
  'text/tsx': '.tsx',
  'text/x-dart': '.dart',
  'text/x-swift': '.swift',
};

/**
 * Extensions that identify a *text deliverable's* own file identity.
 *
 * A multi-file code export writes several files under one job (a component
 * plus its stylesheet). The job's format extension only describes the entry
 * file, so applying it to every sibling produced `card.module.css.tsx`. When
 * the file name already carries a code extension, that extension is the file's
 * real identity and wins.
 */
const CODE_EXTENSIONS = new Set([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.vue',
  '.svelte',
  '.dart',
  '.swift',
  '.json',
]);

function ownExtension(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 && dot < base.length - 1 ? base.slice(dot).toLowerCase() : '';
}

export function extensionForExport(fileName: string, mimeType: string, job?: ExportJob): string {
  const own = ownExtension(fileName);
  if (CODE_EXTENSIONS.has(own)) return own;

  const fromFormat = job ? FORMAT_EXTENSIONS[job.format] : undefined;
  if (fromFormat) return fromFormat;

  const fromMime = MIME_EXTENSIONS[mimeType];
  if (fromMime) return fromMime;

  // The filename is only a hint. Reject a bare trailing dot (`Logo.` →
  // `"."`), separators, and empty results; anything questionable falls back
  // to a generic extension rather than producing a malformed filename.
  if (own.length > 1) return own;

  return '.bin';
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function downloadBytes(fileName: string, bytes: Uint8Array, mimeType: string): string | null {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null;

  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}

export async function saveExportBytes(
  platform: Platform | undefined,
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
  extension: string,
): Promise<string | null> {
  if (platform?.kind === 'tauri' || platform?.kind === 'web') {
    return await platform.saveBinaryFile(fileName, bytes, mimeType, extension);
  }

  return downloadBytes(fileName, bytes, mimeType);
}

export function createExportSaveFile(platform?: Platform): ExportRunContext['saveFile'] {
  return async (fileName, bytes, mimeType, job) => {
    return await saveExportBytes(
      platform,
      fileName,
      bytes,
      mimeType,
      extensionForExport(fileName, mimeType, job),
    );
  };
}

/**
 * Attempts before a folder export gives up looking for an unused name. A
 * destination folder with a thousand same-named files is either a mistake or a
 * broken probe; refusing beats writing over one of them.
 */
const MAX_DESTINATION_NAME_PROBES = 999;

/** Absolute path for a portable export entry below a chosen destination folder. */
function joinFolderEntry(folder: string, entry: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '');
  // A POSIX root trims to an empty string; a Windows drive root ("C:") trims to
  // the drive prefix and joins as "C:/entry". Both stay absolute for the probe.
  return trimmed === '' ? `/${entry}` : `${trimmed}/${entry}`;
}

type DestinationProbe = 'free' | 'occupied' | 'unknown';

async function probeDestination(platform: Platform, path: string): Promise<DestinationProbe> {
  try {
    return (await platform.fileExists(path)) ? 'occupied' : 'free';
  } catch {
    // A failed probe cannot tell us whether a write is safe. Report it as
    // unknown instead of guessing "free" and overwriting later in the loop.
    return 'unknown';
  }
}

/**
 * Choose the name a folder export will actually write. Re-exporting into a
 * folder that already contains an output used to replace the old file without
 * a prompt; the shared conflict policy is "rename", so an occupied name is
 * suffixed deterministically (`Logo-2.png`, `Logo-3.png`, ...) instead of
 * silently destroying the previous export.
 */
async function resolveDestinationEntry(
  platform: Platform,
  folder: string,
  entry: string,
): Promise<string> {
  const first = await probeDestination(platform, joinFolderEntry(folder, entry));
  if (first === 'free') return entry;
  if (first === 'unknown') {
    // Fail closed: writing the requested name (or any suffix) without a working
    // existence probe could replace a file the user cannot recover.
    throw new Error(
      `Could not verify whether "${entry}" already exists in the export folder; nothing was written. Check the destination folder and export again.`,
    );
  }
  for (let counter = 2; counter <= MAX_DESTINATION_NAME_PROBES; counter += 1) {
    const candidate = appendSuffix(entry, counter);
    const probe = await probeDestination(platform, joinFolderEntry(folder, candidate));
    if (probe === 'free') return candidate;
    if (probe === 'unknown') {
      throw new Error(
        `Could not verify whether "${candidate}" already exists in the export folder; nothing was written. Check the destination folder and export again.`,
      );
    }
  }
  throw new Error(`No unused file name was available for "${entry}" in the export folder.`);
}

export function createExportFolderSaveFile(
  platform: Platform,
  folder: string,
): NonNullable<ExportRunContext['saveFile']> {
  return async (fileName, bytes, _mimeType, job) => {
    const requestedEntry = safeArchiveEntryPath(fileName);
    const entry = await resolveDestinationEntry(platform, folder, requestedEntry);
    const written = await platform.writeBinaryFileToFolder(folder, entry, bytes);
    // The results report is built from `job.fileName`. When this call wrote the
    // job's own output under a conflict-avoiding name, reflect the name that
    // actually landed on disk instead of the requested one; sibling files of a
    // multi-file deliverable keep their own names and must not retitle the job.
    if (safeArchiveEntryPath(job.fileName) === requestedEntry) job.fileName = entry;
    return written;
  };
}

export interface BufferedExportArchive {
  /** Archive entries only need a path and bytes; MIME/job metadata is not
   * persisted inside the ZIP and would make package export needlessly coupled
   * to raster ExportJob records. The optional trailing arguments preserve the
   * ExportRunContext sink shape for existing batch-export callers. */
  saveFile: (
    fileName: string,
    bytes: Uint8Array,
    _mimeType?: string,
    _job?: ExportJob,
  ) => Promise<string | null | undefined>;
  fileCount: () => number;
  flush: (archiveName: string) => Promise<string | null>;
}

function safeArchiveEntryPath(fileName: string): string {
  const segments = fileName
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeSegment(segment, { keepDots: true }).trim())
    .filter(Boolean);
  return segments.join('/') || 'export.bin';
}

/**
 * Buffer a browser batch and deliver it as one ZIP. This prevents a batch from
 * opening one picker or uncontrolled download per output. Only successful
 * rendered files reach the archive because ExportService calls the sink after
 * rendering each output.
 */
export function createBufferedExportArchive(platform?: Platform): BufferedExportArchive {
  const files: Record<string, Uint8Array> = {};
  let count = 0;

  return {
    saveFile: async (fileName, bytes) => {
      let entry = safeArchiveEntryPath(fileName);
      if (files[entry]) {
        const dot = entry.lastIndexOf('.');
        const stem = dot > 0 ? entry.slice(0, dot) : entry;
        const extension = dot > 0 ? entry.slice(dot) : '';
        let suffix = 2;
        while (files[`${stem}-${suffix}${extension}`]) suffix += 1;
        entry = `${stem}-${suffix}${extension}`;
      }
      files[entry] = bytes;
      count += 1;
      return entry;
    },
    fileCount: () => count,
    flush: async (archiveName) => {
      if (count === 0) return null;
      const fileName = archiveName.toLowerCase().endsWith('.zip')
        ? archiveName
        : `${archiveName}.zip`;
      return await saveExportBytes(
        platform,
        fileName,
        zipSync(files, { level: 6 }),
        'application/zip',
        '.zip',
      );
    },
  };
}
