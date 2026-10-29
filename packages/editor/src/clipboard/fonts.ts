/** Portable clipboard font closure: request collection, embedding policy, and restore. */

import { getFontRegistry } from '@varve/engine';
import type { EmbeddingRights, FontReference } from '@varve/engine/font';
import {
  collectFontData,
  FontLoader,
  fontReferenceKey,
  storeFontOnFilesystem,
} from '@varve/engine/font';
import type { Document, SceneNode } from '@varve/scene';
import { MAX_CLIPBOARD_FONT_BYTES, MAX_CLIPBOARD_FONT_DEPENDENCIES } from './mime';
import type { ClipboardFontDependency } from './types';

interface ClipboardFontRequest {
  family: string;
  fontReference?: FontReference;
}
function clipboardFontRequestKey(request: ClipboardFontRequest): string {
  return request.fontReference
    ? `${request.family.toLowerCase()}\u0000${fontReferenceKey(request.fontReference)}`
    : request.family.toLowerCase();
}
function collectClipboardFontRequests(
  nodes: readonly SceneNode[],
  styles?: Document['styles'],
): ClipboardFontRequest[] {
  const requests = new Map<string, ClipboardFontRequest>();
  const add = (family: string | undefined, fontReference?: FontReference): void => {
    const normalized = family?.trim();
    if (!normalized) return;
    const request = { family: normalized, ...(fontReference ? { fontReference } : {}) };
    requests.set(clipboardFontRequestKey(request), request);
  };
  for (const node of nodes) {
    if (node.kind !== 'text') continue;
    add(node.fontFamily, node.fontReference);
    for (const paragraph of node.richText?.paragraphs ?? []) {
      for (const run of paragraph.runs ?? []) {
        add(run.format?.fontFamily, run.format?.fontReference);
      }
    }
  }
  for (const style of Object.values(styles ?? {})) {
    const candidate = style as unknown as {
      type?: string;
      fontFamily?: string;
      fontReference?: FontReference;
      format?: { fontFamily?: string; fontReference?: FontReference };
      characterFormat?: { fontFamily?: string; fontReference?: FontReference };
    };
    if (candidate.type === 'text') add(candidate.fontFamily, candidate.fontReference);
    add(candidate.format?.fontFamily, candidate.format?.fontReference);
    add(candidate.characterFormat?.fontFamily, candidate.characterFormat?.fontReference);
  }
  return [...requests.values()].sort((a, b) =>
    clipboardFontRequestKey(a).localeCompare(clipboardFontRequestKey(b)),
  );
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof btoa === 'function') return btoa(binary);
  const BufferCtor = (
    globalThis as unknown as {
      Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } };
    }
  ).Buffer;
  return BufferCtor?.from(bytes).toString('base64') ?? '';
}
export function base64ToBytes(value: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    const BufferCtor = (
      globalThis as unknown as {
        Buffer?: { from(value: string, encoding: string): Uint8Array };
      }
    ).Buffer;
    return BufferCtor ? new Uint8Array(BufferCtor.from(value, 'base64')) : null;
  } catch {
    return null;
  }
}
function isEmbeddingPermitted(rights: EmbeddingRights | undefined): boolean {
  return rights === 'installable' || rights === 'editable' || rights === 'no-subsetting';
}
/** Build a portable, bounded font closure for a native/browser clipboard write. */
export async function prepareClipboardFontDependencies(
  nodes: readonly SceneNode[],
  styles: Document['styles'] | undefined,
  manifest: Document['fontManifest'] | undefined,
): Promise<ClipboardFontDependency[]> {
  const requests = collectClipboardFontRequests(nodes, styles);
  if (requests.length === 0) return [];
  const manifestByKey = new Map<string, NonNullable<Document['fontManifest']>['fonts'][number]>();
  for (const entry of manifest?.fonts ?? []) {
    const key = entry.fontReference
      ? `${entry.familyName.toLowerCase()}\u0000${fontReferenceKey(entry.fontReference)}`
      : entry.familyName.toLowerCase();
    manifestByKey.set(key, entry);
  }
  const exactRequests = requests.filter((request) => request.fontReference);
  const records = await collectFontData(exactRequests, {
    // Copying a layer must never start a remote font download. An explicit
    // package export may fetch bundled assets; clipboard writes stay local.
    fetchBundled: false,
  });
  const recordsByKey = new Map(
    records.map((record) => [
      clipboardFontRequestKey({ family: record.family, fontReference: record.fontReference }),
      record,
    ]),
  );
  let embeddedBytes = 0;
  return requests.slice(0, MAX_CLIPBOARD_FONT_DEPENDENCIES).map((request) => {
    const exactKey = clipboardFontRequestKey(request);
    const entry =
      manifestByKey.get(exactKey) ??
      (!request.fontReference ? manifestByKey.get(request.family.toLowerCase()) : undefined);
    const record = request.fontReference ? recordsByKey.get(exactKey) : undefined;
    const rights = entry?.embeddingRights;
    const canEmbed = Boolean(record && request.fontReference && isEmbeddingPermitted(rights));
    const withinBudget = Boolean(
      canEmbed && record && embeddedBytes + record.data.byteLength <= MAX_CLIPBOARD_FONT_BYTES,
    );
    if (withinBudget && record) embeddedBytes += record.data.byteLength;
    const status: ClipboardFontDependency['status'] = withinBudget
      ? 'embedded'
      : rights === 'restricted'
        ? 'restricted'
        : request.fontReference && !record
          ? 'missing'
          : 'metadata-only';
    const identity = entry?.identity;
    return {
      family: request.family,
      ...(request.fontReference ? { fontReference: request.fontReference } : {}),
      ...(identity?.postScriptName ? { postScriptName: identity.postScriptName } : {}),
      ...(entry?.requestedWeight !== undefined ? { requestedWeight: entry.requestedWeight } : {}),
      ...(entry?.requestedStyle ? { requestedStyle: entry.requestedStyle } : {}),
      ...(entry?.source ? { source: entry.source } : {}),
      ...(rights ? { embeddingRights: rights } : {}),
      ...(entry?.embeddingPolicy ? { embeddingPolicy: entry.embeddingPolicy } : {}),
      status,
      ...(withinBudget && record ? { dataBase64: bytesToBase64(record.data) } : {}),
    };
  });
}
/** Restore permitted clipboard font bytes without dirtying the document. */
export async function restoreClipboardFontDependencies(
  dependencies: readonly ClipboardFontDependency[] | undefined,
  documentId?: string,
): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  if (!dependencies) return { restored, skipped };
  const loader = new FontLoader(undefined, getFontRegistry());
  for (const dependency of dependencies.slice(0, MAX_CLIPBOARD_FONT_DEPENDENCIES)) {
    if (dependency.status !== 'embedded' || !dependency.fontReference || !dependency.dataBase64) {
      skipped++;
      continue;
    }
    const bytes = base64ToBytes(dependency.dataBase64);
    if (!bytes || bytes.byteLength > MAX_CLIPBOARD_FONT_BYTES) {
      skipped++;
      continue;
    }
    const reference = dependency.fontReference;
    const metadata = {
      providerId: 'clipboard',
      artifactHash: reference.artifactHash,
      collectionIndex: reference.collectionIndex,
      faceKey: fontReferenceKey(reference),
      ...(dependency.postScriptName ? { postScriptName: dependency.postScriptName } : {}),
      ...(documentId ? { documentId, scope: 'project' as const } : {}),
    };
    try {
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await storeFontOnFilesystem(dependency.family, buffer, metadata);
      const result = await loader.restoreFont(dependency.family, buffer, metadata);
      if (result.success) restored++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { restored, skipped };
}
