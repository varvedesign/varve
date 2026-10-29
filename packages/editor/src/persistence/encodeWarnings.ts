/**
 * Surface codec encode warnings on persistence paths that previously dropped them.
 *
 * Save, autosave/recovery, and package export all serialize through DocumentCodec.
 * Warning-or-error findings are logged once per distinct message. The toast is
 * shown only after a handler is registered, so a recovery encode during startup
 * is not forgotten. Opening a document clears that memory so a later file can
 * warn again.
 */
import { type Document, DocumentCodec, type DocumentCodecWarning } from '@varve/scene';

const toastedMessages = new Set<string>();
const loggedMessages = new Set<string>();
const pendingToasts = new Set<string>();
let toastReporter: ((message: string) => void) | undefined;

function flushPendingToasts(report: (message: string) => void): void {
  if (pendingToasts.size === 0) return;
  const queued = [...pendingToasts];
  pendingToasts.clear();
  for (const message of queued) {
    if (toastedMessages.has(message)) continue;
    toastedMessages.add(message);
    report(message);
  }
}

export function setEncodeWarningToast(report?: (message: string) => void): void {
  toastReporter = report;
  if (report) flushPendingToasts(report);
}

/** Drop one-shot encode notices so a newly opened document can warn again. */
export function clearEncodeWarningState(): void {
  toastedMessages.clear();
  loggedMessages.clear();
  pendingToasts.clear();
}

export function notableEncodeWarnings(
  warnings: readonly DocumentCodecWarning[],
): DocumentCodecWarning[] {
  return warnings.filter(
    (warning) => warning.severity === 'warning' || warning.severity === 'error',
  );
}

export function formatEncodeWarningToast(warnings: readonly DocumentCodecWarning[]): string | null {
  const notable = notableEncodeWarnings(warnings);
  if (notable.length === 0) return null;
  const first = notable[0]!.message;
  return notable.length === 1 ? first : `${first} (${notable.length} issues on save)`;
}

export function surfaceEncodeWarnings(
  warnings: readonly DocumentCodecWarning[],
  report?: (message: string) => void,
): void {
  const notable = notableEncodeWarnings(warnings);
  if (notable.length === 0) return;
  const message = formatEncodeWarningToast(notable);
  if (!message) return;
  if (toastedMessages.has(message)) return;
  if (!loggedMessages.has(message)) {
    loggedMessages.add(message);
    for (const warning of notable) {
      console.warn(`[varve encode] ${warning.code}: ${warning.message}`);
    }
  }
  const notify = report ?? toastReporter;
  if (!notify) {
    pendingToasts.add(message);
    return;
  }
  toastedMessages.add(message);
  pendingToasts.delete(message);
  notify(message);
}

export function encodeDocumentJson(
  doc: Document,
  report?: (message: string) => void,
): { json: string; warnings: DocumentCodecWarning[] } {
  const encoded = DocumentCodec.encodeWithWarnings(doc);
  surfaceEncodeWarnings(encoded.warnings, report);
  return encoded;
}
