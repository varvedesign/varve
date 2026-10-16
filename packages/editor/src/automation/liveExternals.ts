/**
 * Commands whose effect is outside the document model, served by a live editor.
 *
 * Both of these reach beyond "edit the scene": one writes a file, the other
 * produces pixels that can leave the device. So each is gated twice - by a
 * permission the person granted, and by the same executor approval hold as any
 * other change - and each refuses rather than guesses when the safe answer
 * needs a person:
 *
 * - **Save writes where the person already chose, and nowhere else.** A
 *   document that has never been saved has no destination; the first Save asks.
 *   An agent cannot answer an OS dialog, and must not be able to pick a path.
 * - **Capture says whether it is finished.** Rendering waits for fonts and
 *   images through the export pipeline's own barrier. An image that rendered
 *   while artwork was still loading is reported `complete: false` with the
 *   reason; it is never presented as final.
 */
import type { ExternalHandler, ExternalResult } from '@varve/automation';
import { CAPTURE_MAX_IMAGE_BYTES } from '@varve/automation';
import type { Document } from '@varve/scene';
import type { EditorContextValue } from '../context';
import { saveTargetFromSession } from '../persistence/saveTypes';

export interface RenderedNode {
  bytes: Uint8Array;
  width: number;
  height: number;
  scale: number;
  bounds: { x: number; y: number; w: number; h: number };
  warnings: string[];
  /** True when every image resource settled before rendering began. */
  settled: boolean;
  backend: string;
}

export interface RenderRequest {
  document: Document;
  nodeId: string;
  /** Pixels per document unit. */
  scale: number;
  background: 'transparent' | 'white';
}

export type RenderNode = (request: RenderRequest) => Promise<RenderedNode>;

export interface LiveExternalsDeps {
  editor: () => EditorContextValue | null;
  /** Defaults to the export pipeline. Injectable so tests need no canvas. */
  render?: RenderNode;
  now?: () => number;
}

const NO_EDITOR: ExternalResult = {
  ok: false,
  code: 'UNAVAILABLE',
  message: 'the editor is not available to this session',
};

// ── Save ─────────────────────────────────────────────────────────────────────

function saveHandler(deps: LiveExternalsDeps): ExternalHandler {
  return async (args): Promise<ExternalResult> => {
    const editor = deps.editor();
    if (!editor) return NO_EDITOR;
    const request = args as { path?: string };
    if (request.path !== undefined) {
      return {
        ok: false,
        code: 'PERMISSION_DENIED',
        message:
          'a live session saves where the person saved this document; it cannot choose a file',
        hint: 'omit path. Saving to a different file is Save As, which a person does from the File menu.',
      };
    }

    const before = editor.readAutomationState();
    const target = saveTargetFromSession(before.session ?? undefined);
    if (target.kind === 'unsaved' || target.kind === 'download-only') {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'this document has not been saved yet, so there is no place to save it to',
        hint: 'a person must save it once (File > Save) to choose where it lives. Nothing was written.',
      };
    }
    if (target.kind === 'web-file-handle') {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message:
          'this document is bound to a browser file handle, which can need a permission prompt',
        hint: 'a person must save from the File menu. Nothing was written.',
      };
    }

    const savedRevision = before.revision;
    const saved = await editor.save();
    const after = editor.readAutomationState();
    if (!saved) {
      const reason = after.saveIssue?.message;
      return {
        ok: false,
        code: 'INTERNAL',
        message: reason
          ? `the document was not saved: ${reason}`
          : 'the editor reported that the save did not complete',
        hint: 'the document is unchanged and still unsaved. A person can try File > Save.',
      };
    }

    const destination =
      target.kind === 'native-file' ? target.path : `varve-library:${target.fileId}`;
    const moved = after.revision !== savedRevision;
    return {
      ok: true,
      summary: moved
        ? `Saved revision ${savedRevision} to ${destination}. The document changed while it saved (now revision ${after.revision}); save again to include that.`
        : `Saved revision ${savedRevision} to ${destination}.`,
      output: { path: destination, revision: savedRevision },
      durable: { saved: !moved || after.session?.dirty === false, path: destination },
    };
  };
}

// ── Capture ──────────────────────────────────────────────────────────────────

/** Never render larger than this multiple of a node's natural size. */
const MAX_UPSCALE = 4;
/** Attempts to fit the encoded image into the byte budget by shrinking. */
const FIT_ATTEMPTS = 4;

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function captureHandler(deps: LiveExternalsDeps): ExternalHandler {
  const now = deps.now ?? (() => performance.now());
  // One engine per controller, created on first use and reused after.
  let renderer: Promise<RenderNode> | null = null;
  return async (args): Promise<ExternalResult> => {
    const editor = deps.editor();
    if (!editor) return NO_EDITOR;
    const request = args as {
      nodeId: string;
      maxDimension: number;
      background: 'transparent' | 'white';
    };
    renderer ??= Promise.resolve(deps.render ?? defaultRender());
    const render = await renderer;

    // One immutable snapshot: the pixels show exactly this revision even if a
    // person keeps editing while the (async) render runs.
    const snapshot = editor.readAutomationState();
    const node = snapshot.document.nodes[request.nodeId];
    if (!node) {
      return {
        ok: false,
        code: 'UNKNOWN_TARGET',
        message: `node ${request.nodeId} does not exist in the open document`,
        hint: 'list nodes with varve.node.list and pass an id from the current revision',
      };
    }

    const started = now();
    // Pick a scale from the node's own size so the longest edge lands near the
    // request; effects and padding can add a little, so the result is checked.
    const natural = naturalExtent(node);
    let scale = Math.min(MAX_UPSCALE, request.maxDimension / Math.max(natural, 1));
    let rendered: RenderedNode | null = null;
    for (let attempt = 0; attempt < FIT_ATTEMPTS; attempt += 1) {
      let candidate: RenderedNode;
      try {
        candidate = await render({
          document: snapshot.document,
          nodeId: request.nodeId,
          scale,
          background: request.background,
        });
      } catch (error) {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: `the node could not be rendered: ${error instanceof Error ? error.message : String(error)}`,
          hint: 'a font or image it needs may not have loaded. Nothing was changed; try again.',
        };
      }
      const longest = Math.max(candidate.width, candidate.height);
      const tooBig =
        longest > request.maxDimension || candidate.bytes.length > CAPTURE_MAX_IMAGE_BYTES;
      rendered = candidate;
      if (!tooBig) break;
      const byDimension = request.maxDimension / longest;
      const byBytes = candidate.bytes.length > CAPTURE_MAX_IMAGE_BYTES ? 0.7 : 1;
      scale = candidate.scale * Math.min(byDimension, byBytes) * 0.98;
      rendered = null;
    }
    if (!rendered) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: `the image could not be made to fit ${CAPTURE_MAX_IMAGE_BYTES} bytes and ${request.maxDimension}px`,
        hint: 'request a smaller maxDimension or a smaller node',
      };
    }

    const current = editor.readAutomationState().revision;
    // Informational warnings (a safety downscale, metadata notes) do not make
    // an image unfinished; unsettled or failed artwork does.
    const complete = rendered.settled;
    return {
      ok: true,
      summary: complete
        ? `Captured ${request.nodeId} at revision ${snapshot.revision}: ${rendered.width}x${rendered.height}px.`
        : `Captured ${request.nodeId} at revision ${snapshot.revision}: ${rendered.width}x${rendered.height}px, NOT final - ${rendered.warnings[0] ?? 'some artwork had not finished loading'}.`,
      output: {
        kind: 'document-pixels' as const,
        nodeId: request.nodeId,
        revision: snapshot.revision,
        currentRevision: current,
        complete,
        warnings: rendered.warnings.slice(0, 50).map((w) => w.slice(0, 1000)),
        width: rendered.width,
        height: rendered.height,
        scale: rendered.scale,
        bounds: rendered.bounds,
        background: request.background,
        renderMs: Math.round(now() - started),
        backend: rendered.backend,
        image: {
          mimeType: 'image/png' as const,
          bytes: rendered.bytes.length,
          data: base64(rendered.bytes),
        },
      },
    };
  };
}

function naturalExtent(node: Document['nodes'][string]): number {
  const w = 'w' in node && typeof node.w === 'number' ? node.w : 0;
  const h = 'h' in node && typeof node.h === 'number' ? node.h : 0;
  return Math.max(w, h, 1);
}

/** The real renderer: the same export pipeline File > Export uses. */
async function defaultRender(): Promise<RenderNode> {
  const [{ exportNodeAsRaster }, { createEngine }] = await Promise.all([
    import('../components/SpecPanel/export'),
    import('@varve/engine'),
  ]);
  let engine: Awaited<ReturnType<typeof createEngine>> | null = null;
  return async ({ document, nodeId, scale, background }) => {
    const node = document.nodes[nodeId];
    if (!node) throw new Error(`node ${nodeId} is not in the document`);
    engine ??= await createEngine('auto');
    const result = await exportNodeAsRaster(node, document, engine, {
      format: 'image/png',
      scale,
      transparency: background === 'transparent',
      ...(background === 'white'
        ? { matteColor: [255, 255, 255, 255] as [number, number, number, number] }
        : {}),
    });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    return {
      bytes,
      width: result.geometry.width,
      height: result.geometry.height,
      scale: result.geometry.scale,
      bounds: result.geometry.bounds,
      warnings: result.warnings,
      settled: result.readiness.images === 'ready',
      backend: 'export-pipeline/canvas2d',
    };
  };
}

export function createLiveExternals(deps: LiveExternalsDeps): Record<string, ExternalHandler> {
  return {
    'varve.document.save': saveHandler(deps),
    'varve.capture.node': captureHandler(deps),
  };
}
