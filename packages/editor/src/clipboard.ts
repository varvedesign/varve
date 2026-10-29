/**
 * System clipboard integration for Varve node data.
 *
 * Copies nodes as `application/vnd.varve+json` (preserves structure for
 * in-app paste) and `text/plain` (fallback for paste-into-text-editor).
 * The legacy `application/vnd.strata+json` type is written and read
 * alongside it so clipboard payloads survive an upgrade between builds.
 * Reads clipboard in a single pass for Varve JSON, SVG text, and images.
 *
 * The payload includes both image assets and raster-mask assets referenced by
 * the copied node closure so cross-document paste remains self-contained.
 *
 * Research basis: Clipboard API (W3C), custom MIME types for structured data.
 */

export { restoreClipboardFontDependencies } from './clipboard/fonts';
export {
  LEGACY_MIME,
  VARVE_MIME,
  WEB_LEGACY_MIME,
  WEB_VARVE_MIME,
} from './clipboard/mime';
export { parseClipboardData } from './clipboard/parse';
export { readClipboardUnified, readFromClipboardEvent } from './clipboard/read';
export { canPreserveClipboardWorldPose, orderClipboardRoots } from './clipboard/selection';
export {
  cancelPasteFallback,
  captureClipboardEvent,
  claimPendingTransferRequest,
  clearCapturedClipboardEvent,
  createTransferRequest,
  getClipboardSnapshot,
  getLatestTransferRequest,
  isNativeClipboardTarget,
  readClipboardUnifiedWithFallback,
  schedulePasteFallback,
} from './clipboard/transfer';
export type {
  ClipboardCapabilities,
  ClipboardData,
  ClipboardFontDependency,
  ClipboardImportItem,
  ClipboardRequest,
  ClipboardSelectionSnapshot,
  ClipboardSnapshot,
  ClipboardWriteOutcome,
  TransferIntent,
  TransferOutcome,
  TransferRequest,
  UnifiedClipboardResult,
} from './clipboard/types';
export {
  writeClipboard,
  writeClipboardOutcome,
  writeClipboardRepresentation,
} from './clipboard/write';
export { clipboardRichTextWarning, parseClipboardRichText } from './clipboardRichText';
