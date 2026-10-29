/** Serialized clipboard write queue and the Varve/legacy/web write pipelines. */

import type { DepthMapResource } from '@varve/engine';
import type { Platform } from '@varve/platform';
import type {
  Document,
  DocumentAsset,
  DocumentIconAsset,
  LayoutGrid,
  MockupTemplateAsset,
  RasterMaskAsset,
  SceneNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { prepareClipboardFontDependencies } from './fonts';
import {
  LEGACY_MIME,
  MAX_CLIPBOARD_JSON_BYTES,
  VARVE_MIME,
  WEB_LEGACY_MIME,
  WEB_VARVE_MIME,
} from './mime';
import { parseClipboardData, serializeClipboardData } from './parse';
import type { ClipboardWriteOutcome } from './types';

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}
let clipboardWriteTail: Promise<void> = Promise.resolve();
let latestClipboardWrite = 0;
function enqueueClipboardWrite(
  operation: (generation: number) => Promise<ClipboardWriteOutcome>,
): Promise<ClipboardWriteOutcome> {
  const generation = ++latestClipboardWrite;
  const run = clipboardWriteTail.then(() => operation(generation));
  clipboardWriteTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
/** Serialize clipboard writes and suppress late fallbacks from superseded requests. */
export function writeClipboardOutcome(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
  patternDefinitions?: Document['patternDefinitions'],
  sourcePageId?: string,
): Promise<ClipboardWriteOutcome> {
  return enqueueClipboardWrite((generation) =>
    writeClipboardOutcomeNow(
      nodes,
      rasterMaskAssets,
      assets,
      iconAssets,
      worldAnchor,
      rootIds,
      mockupTemplates,
      platform,
      sourceDocumentId,
      generativeEdits,
      components,
      styles,
      paints,
      variableStore,
      interactions,
      timelines,
      stories,
      motionExtensions,
      motionPresets,
      generation,
      dependencyIds,
      depthMaps,
      fontManifest,
      frameGuideLayouts,
      patternDefinitions,
      sourcePageId,
    ),
  );
}
/**
 * Publish a single non-Varve representation (Copy Text/SVG/PNG) through the
 * same serialized write queue as object copies. A superseded operation is
 * reported as failed and cannot issue a late fallback write.
 */
export function writeClipboardRepresentation(
  mimeType: string,
  data: Uint8Array,
  plainText: string,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
): Promise<ClipboardWriteOutcome> {
  return enqueueClipboardWrite((generation) =>
    writeClipboardRepresentationNow(mimeType, data, plainText, platform, generation),
  );
}
async function writeClipboardRepresentationNow(
  mimeType: string,
  data: Uint8Array,
  plainText: string,
  platform: Pick<Platform, 'kind' | 'writeClipboardData'> | undefined,
  generation: number,
): Promise<ClipboardWriteOutcome> {
  const isCurrentWrite = (): boolean => generation === latestClipboardWrite;
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (platform?.kind === 'tauri') {
    try {
      const written = await platform.writeClipboardData([{ mimeType, data }]);
      if (written && isCurrentWrite()) return { status: 'editable', mimeTypes: [mimeType] };
    } catch {
      // Continue through browser and text-only fallbacks.
    }
  }
  if (!isCurrentWrite() || typeof navigator === 'undefined' || !navigator.clipboard) {
    return { status: 'failed', reason: 'write-failed' };
  }
  const clipboardItemCtor = globalThis.ClipboardItem;
  if (typeof clipboardItemCtor === 'function' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new clipboardItemCtor({
          [mimeType]: new Blob([data as unknown as BlobPart], { type: mimeType }),
          'text/plain': plainText,
        }),
      ]);
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      return { status: 'editable', mimeTypes: [mimeType, 'text/plain'] };
    } catch {
      // Text is still useful in an external editor.
    }
  }
  if (!isCurrentWrite() || typeof navigator.clipboard.writeText !== 'function') {
    return { status: 'failed', reason: 'write-failed' };
  }
  try {
    await navigator.clipboard.writeText(plainText);
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return { status: 'text-only', reason: 'editable-format-unavailable' };
  } catch (error) {
    return {
      status: 'failed',
      reason: isPermissionError(error) ? 'permission-denied' : 'write-failed',
    };
  }
}
async function writeClipboardOutcomeNow(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
  generation?: number,
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
  patternDefinitions?: Document['patternDefinitions'],
  sourcePageId?: string,
): Promise<ClipboardWriteOutcome> {
  const isCurrentWrite = (): boolean =>
    generation === undefined || generation === latestClipboardWrite;
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  let json: string;
  try {
    const fontDependencies = await prepareClipboardFontDependencies(nodes, styles, fontManifest);
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    json = serializeClipboardData(
      nodes,
      rasterMaskAssets,
      assets,
      iconAssets,
      worldAnchor,
      rootIds,
      mockupTemplates,
      sourceDocumentId,
      generativeEdits,
      components,
      styles,
      paints,
      variableStore,
      interactions,
      timelines,
      stories,
      motionExtensions,
      motionPresets,
      dependencyIds,
      depthMaps,
      fontManifest,
      fontDependencies,
      frameGuideLayouts,
      patternDefinitions,
      sourcePageId,
    );
  } catch {
    return { status: 'failed', reason: 'write-failed' };
  }
  // A browser/native clipboard write can succeed even when the payload is
  // larger than the reader's budget or cannot be rehydrated.  Cut must never
  // delete its source on the strength of such a write.  Validate the exact
  // bytes that will be offered before publishing them.
  const encodedJson = new TextEncoder().encode(json);
  if (encodedJson.byteLength > MAX_CLIPBOARD_JSON_BYTES || !parseClipboardData(json)) {
    return { status: 'failed', reason: 'write-failed' };
  }
  const text =
    rootIds && rootIds.length > 0
      ? rootIds
          .map((id) => nodes.find((node) => node.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join('\n')
      : nodes.map((n) => n.name).join('\n');
  const textBlob = new Blob([text], { type: 'text/plain' });
  if (platform?.kind === 'tauri') {
    try {
      const written = await platform.writeClipboardData([
        { mimeType: VARVE_MIME, data: new TextEncoder().encode(json) },
        { mimeType: LEGACY_MIME, data: new TextEncoder().encode(json) },
        { mimeType: 'text/plain', data: new TextEncoder().encode(text) },
      ]);
      if (written && isCurrentWrite()) {
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      }
    } catch {
      // Native rich clipboard support is optional; continue through the
      // browser API and its text-only fallback when it is unavailable.
    }
  }
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return { status: 'failed', reason: 'clipboard-unavailable' };
  }
  const clipboardItemCtor = globalThis.ClipboardItem;
  if (typeof clipboardItemCtor === 'function' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new clipboardItemCtor({
          [WEB_VARVE_MIME]: new Blob([json], { type: WEB_VARVE_MIME }),
          [WEB_LEGACY_MIME]: new Blob([json], { type: WEB_LEGACY_MIME }),
          'text/plain': textBlob,
        }),
      ]);
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      return { status: 'editable', mimeTypes: [WEB_VARVE_MIME, WEB_LEGACY_MIME, 'text/plain'] };
    } catch (firstError) {
      if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
      try {
        await navigator.clipboard.write([
          new clipboardItemCtor({
            [VARVE_MIME]: new Blob([json], { type: VARVE_MIME }),
            [LEGACY_MIME]: new Blob([json], { type: LEGACY_MIME }),
            'text/plain': textBlob,
          }),
        ]);
        if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
        return { status: 'editable', mimeTypes: [VARVE_MIME, LEGACY_MIME, 'text/plain'] };
      } catch (secondError) {
        if (isPermissionError(firstError) || isPermissionError(secondError)) {
          // Continue to the explicit text-only fallback. It is useful in an
          // external editor but must never authorize a destructive Cut.
        }
      }
    }
  }
  if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
  if (typeof navigator.clipboard.writeText !== 'function') {
    return { status: 'failed', reason: 'clipboard-unavailable' };
  }
  try {
    await navigator.clipboard.writeText(text);
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return { status: 'text-only', reason: 'editable-format-unavailable' };
  } catch (error) {
    if (!isCurrentWrite()) return { status: 'failed', reason: 'write-failed' };
    return {
      status: 'failed',
      reason: isPermissionError(error) ? 'permission-denied' : 'write-failed',
    };
  }
}
/**
 * Backward-compatible boolean for small callers. New destructive workflows
 * must use writeClipboardOutcome so text-only output cannot look editable.
 */
export async function writeClipboard(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  platform?: Pick<Platform, 'kind' | 'writeClipboardData'>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  patternDefinitions?: Document['patternDefinitions'],
  sourcePageId?: string,
): Promise<boolean> {
  return (
    (
      await writeClipboardOutcome(
        nodes,
        rasterMaskAssets,
        assets,
        iconAssets,
        worldAnchor,
        rootIds,
        mockupTemplates,
        platform,
        sourceDocumentId,
        generativeEdits,
        components,
        styles,
        paints,
        variableStore,
        interactions,
        timelines,
        stories,
        motionExtensions,
        motionPresets,
        dependencyIds,
        depthMaps,
        undefined,
        undefined,
        patternDefinitions,
        sourcePageId,
      )
    ).status === 'editable'
  );
}
