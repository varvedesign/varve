/** Transfer-request lifecycle, captured clipboard snapshots, paste fallbacks, and the unified read. */

import type { Platform } from '@varve/platform';
import {
  isVarvePayloadType,
  LEGACY_MIME,
  MAX_CLIPBOARD_JSON_BYTES,
  VARVE_MIME,
  WEB_LEGACY_MIME,
  WEB_VARVE_MIME,
} from './mime';
import { parseClipboardData } from './parse';
import {
  type ClipboardDataSnapshot,
  hasRichClipboardContent,
  hydrateClipboardFonts,
  isSvgText,
  readClipboardSnapshot,
  readClipboardUnified,
  snapshotClipboardData,
} from './read';
import type {
  ClipboardCapabilities,
  ClipboardSnapshot,
  TransferIntent,
  TransferRequest,
  UnifiedClipboardResult,
} from './types';

const NATIVE_CLIPBOARD_READ_TYPES = [
  VARVE_MIME,
  LEGACY_MIME,
  WEB_VARVE_MIME,
  WEB_LEGACY_MIME,
  'image/svg+xml',
  'text/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'text/plain',
];
interface OwnedClipboardSnapshot {
  data: ClipboardDataSnapshot;
  contract: ClipboardSnapshot;
}
let transferSequence = 0;
let latestTransferRequest: TransferRequest | null = null;
const pendingTransferRequests: TransferRequest[] = [];
const capturedClipboardSnapshots = new Map<string, OwnedClipboardSnapshot>();
const pendingPasteFallbacks = new Map<string, ReturnType<typeof setTimeout>>();
export function createTransferRequest(
  intent: TransferIntent = 'paste',
  sessionId?: string,
): TransferRequest {
  transferSequence += 1;
  const id = `${Date.now().toString(36)}-${transferSequence.toString(36)}`;
  const request: TransferRequest = {
    operationId: id,
    gestureId: id,
    intent,
    ...(sessionId ? { sessionId } : {}),
    createdAt: Date.now(),
  };
  latestTransferRequest = request;
  if (intent === 'paste') pendingTransferRequests.push(request);
  return request;
}
export function getLatestTransferRequest(): TransferRequest | null {
  return latestTransferRequest;
}
/**
 * Claim the oldest keyboard paste request for the next synchronous DOM event.
 * A browser can dispatch several paste events before an async import finishes;
 * keeping the identity in the request queue prevents those events from
 * sharing a global snapshot or fallback timer.
 */
export function claimPendingTransferRequest(): TransferRequest {
  return pendingTransferRequests[0] ?? createTransferRequest('paste');
}
function removePendingRequest(request: TransferRequest): void {
  const index = pendingTransferRequests.findIndex(
    (candidate) => candidate.operationId === request.operationId,
  );
  if (index >= 0) pendingTransferRequests.splice(index, 1);
  if (latestTransferRequest?.operationId === request.operationId) {
    latestTransferRequest = pendingTransferRequests[pendingTransferRequests.length - 1] ?? null;
  }
}
function capabilitiesForSnapshot(snapshot: ClipboardDataSnapshot): ClipboardCapabilities {
  return {
    text: Boolean(snapshot.plainText),
    html: Boolean(snapshot.htmlText),
    raster: snapshot.files.some(
      ({ file }) => file.type.startsWith('image/') && file.type !== 'image/svg+xml',
    ),
    customMime: Boolean(snapshot.varveData),
    fileTransfer: snapshot.files.length > 0,
    permission: 'granted',
  };
}
function contractForSnapshot(
  request: TransferRequest,
  snapshot: ClipboardDataSnapshot,
): ClipboardSnapshot {
  const alternatives = [
    snapshot.varveData ? VARVE_MIME : null,
    snapshot.svgText ? 'image/svg+xml' : null,
    snapshot.htmlText ? 'text/html' : null,
    snapshot.plainText ? 'text/plain' : null,
    ...snapshot.files.map(({ file }) => file.type),
  ].filter((value): value is string => Boolean(value));
  return {
    request,
    capturedAt: Date.now(),
    capabilities: capabilitiesForSnapshot(snapshot),
    orderedItems: snapshot.files.map(({ file }) => file.name || file.type),
    alternatives,
  };
}
export function getClipboardSnapshot(request?: TransferRequest): ClipboardSnapshot | null {
  const owned = request ?? latestTransferRequest;
  return owned ? (capturedClipboardSnapshots.get(owned.operationId)?.contract ?? null) : null;
}
/** Snapshot a paste event while its DataTransfer is live; never retain the event itself. */
export function captureClipboardEvent(
  event: ClipboardEvent,
  request?: TransferRequest,
): TransferRequest {
  const owned = request ?? pendingTransferRequests[0] ?? createTransferRequest('paste');
  const data = event.clipboardData ? snapshotClipboardData(event.clipboardData) : null;
  if (data) {
    capturedClipboardSnapshots.set(owned.operationId, {
      data,
      contract: contractForSnapshot(owned, data),
    });
  } else {
    capturedClipboardSnapshots.delete(owned.operationId);
  }
  removePendingRequest(owned);
  latestTransferRequest = owned;
  return owned;
}
/** Clear one captured event (or all legacy captures) after consuming it. */
export function clearCapturedClipboardEvent(request?: TransferRequest): void {
  if (request) {
    capturedClipboardSnapshots.delete(request.operationId);
    removePendingRequest(request);
    return;
  }
  capturedClipboardSnapshots.clear();
  pendingTransferRequests.length = 0;
  latestTransferRequest = null;
}
/** Whether a clipboard event belongs to a browser-owned editing surface. */
export function isNativeClipboardTarget(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  return path.some((entry) => {
    if (typeof HTMLElement === 'undefined' || !(entry instanceof HTMLElement)) return false;
    const tag = entry.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      tag === 'dialog' ||
      entry.isContentEditable ||
      entry.getAttribute('contenteditable') === '' ||
      entry.getAttribute('role') === 'textbox' ||
      entry.hasAttribute('data-clipboard-native')
    );
  });
}
/**
 * Keydown-time fallback for engines that never fire a DOM `paste` event.
 *
 * The Ctrl+V keydown handler deliberately does nothing (no preventDefault,
 * no action) so the browser can deliver a `paste` ClipboardEvent, whose
 * `clipboardData` is the most reliable cross-platform read. Chrome and
 * Firefox fire that event even with non-editable focus — WebKit (incl.
 * WebKitGTK, i.e. the Linux Tauri webview) only fires it into editable
 * elements, so in a canvas app Ctrl+V otherwise dies without ever reaching
 * the paste action. The keydown handler schedules this fallback; a real
 * `paste` event cancels it before running the action itself, so exactly one
 * of the two paths executes.
 */
export function schedulePasteFallback(
  requestOrRun: TransferRequest | (() => void),
  runOrDelay: (() => void) | number = 150,
  delayMs = 150,
): TransferRequest {
  const request =
    typeof requestOrRun === 'function' ? createTransferRequest('paste') : requestOrRun;
  const run = typeof requestOrRun === 'function' ? requestOrRun : (runOrDelay as () => void);
  const timeout = typeof runOrDelay === 'number' ? runOrDelay : delayMs;
  cancelPasteFallback(request);
  pendingPasteFallbacks.set(
    request.operationId,
    setTimeout(() => {
      pendingPasteFallbacks.delete(request.operationId);
      removePendingRequest(request);
      latestTransferRequest = request;
      run();
    }, timeout),
  );
  return request;
}
export function cancelPasteFallback(request?: TransferRequest): void {
  const owned = request ?? pendingTransferRequests[0] ?? latestTransferRequest;
  if (owned) {
    const timer = pendingPasteFallbacks.get(owned.operationId);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingPasteFallbacks.delete(owned.operationId);
    }
    return;
  }
}
/**
 * Read clipboard with event-based fallback.
 *
 * Tries `navigator.clipboard.read()` first (async, may fail on Wayland).
 * Falls back to the last captured DOM paste event (always available for
 * Ctrl+V). Falls back once more to a native OS clipboard read via `platform`
 * (Tauri's Rust backend, bypassing the Web Clipboard API entirely) — this is
 * the only reliable path for menu-triggered ("right-click Paste") reads on
 * WebKitGTK/Wayland, which has no ClipboardEvent to capture and whose
 * `navigator.clipboard.read()` frequently can't surface image MIME types.
 */
export async function readClipboardUnifiedWithFallback(
  platform?: Pick<Platform, 'kind' | 'readClipboardData' | 'readClipboardImage'>,
  request?: TransferRequest,
  documentId?: string,
): Promise<UnifiedClipboardResult> {
  // An explicit request is authoritative. For compatibility with menu and
  // test callers that do not have a request, only reuse the latest request if
  // it still owns an unread snapshot; otherwise create a fresh operation so a
  // previous gesture cannot leak into this read.
  const latestWithSnapshot =
    latestTransferRequest && capturedClipboardSnapshots.has(latestTransferRequest.operationId)
      ? latestTransferRequest
      : null;
  const owned = request ?? latestWithSnapshot ?? createTransferRequest('paste');
  const eventSnapshot = owned ? capturedClipboardSnapshots.get(owned.operationId)?.data : undefined;
  if (owned) {
    capturedClipboardSnapshots.delete(owned.operationId);
    removePendingRequest(owned);
  }
  // Some Chromium builds expose only text to the DOM ClipboardEvent for a
  // custom `web ` MIME item, even though the async Clipboard API can read the
  // rich payload. Prefer the event snapshot when it contains artwork, but
  // fall through when it is text-only instead of turning an editable copy
  // into a pasted text layer.
  const eventResult = eventSnapshot ? await readClipboardSnapshot(eventSnapshot) : null;
  if (eventResult && hasRichClipboardContent(eventResult)) {
    return hydrateClipboardFonts(eventResult, documentId);
  }
  const apiResult = await readClipboardUnified(documentId);
  if (hasRichClipboardContent(apiResult)) {
    return apiResult;
  }
  if (platform?.kind === 'tauri') {
    try {
      const nativeItem = await platform.readClipboardData(NATIVE_CLIPBOARD_READ_TYPES);
      if (nativeItem && nativeItem.data.byteLength <= MAX_CLIPBOARD_JSON_BYTES) {
        if (isVarvePayloadType(nativeItem.mimeType)) {
          const parsed = parseClipboardData(new TextDecoder().decode(nativeItem.data));
          if (parsed)
            return hydrateClipboardFonts({ varveData: parsed, importItems: [] }, documentId);
        } else if (
          nativeItem.mimeType === 'image/svg+xml' ||
          nativeItem.mimeType === 'text/svg+xml'
        ) {
          const text = new TextDecoder().decode(nativeItem.data);
          if (isSvgText(text)) {
            return {
              varveData: null,
              importItems: [{ data: text, mimeType: 'image/svg+xml', name: 'clipboard.svg' }],
            };
          }
        } else if (nativeItem.mimeType.startsWith('image/')) {
          return {
            varveData: null,
            importItems: [
              {
                data: nativeItem.data,
                mimeType: nativeItem.mimeType,
                name: `clipboard.${nativeItem.mimeType.split('/')[1] ?? 'bin'}`,
              },
            ],
          };
        } else if (nativeItem.mimeType === 'text/plain') {
          const text = new TextDecoder().decode(nativeItem.data);
          if (isSvgText(text)) {
            return {
              varveData: null,
              importItems: [{ data: text, mimeType: 'image/svg+xml', name: 'clipboard.svg' }],
            };
          }
          if (text) return { varveData: null, importItems: [], plainText: text };
        }
      }
    } catch {
      // Native rich clipboard read failed; retain the image fallback below.
    }
    try {
      const bytes = await platform.readClipboardImage();
      if (bytes && bytes.length > 0) {
        return {
          varveData: null,
          importItems: [{ data: bytes, mimeType: 'image/png', name: 'clipboard.png' }],
        };
      }
    } catch {
      // Native clipboard read failed (e.g. arboard couldn't reach the OS
      // clipboard) — this is the last-resort tier, so fall through to the
      // empty result rather than rejecting the whole paste() action.
    }
  }
  return eventResult ?? apiResult;
}
