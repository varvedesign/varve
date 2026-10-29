/**
 * Surface codec encode warnings on persistence paths that previously dropped them.
 *
 * Save, autosave/recovery, and package export all serialize through DocumentCodec.
 * Warning-or-error findings are logged and toasted once per distinct message so
 * recovery flushes do not stack the same notice. Opening a document clears that
 * memory so a later file can warn again.
 */
import { type Document, DocumentCodec, type DocumentCodecWarning } from '@varve/scene';

const toastedMessages = new Set<string>();
let toastReporter: ((message: string) => void) | undefined;

export function setEncodeWarningToast(report?: (message: string) => void): void {
  toastReporter = report;
}

/** Drop one-shot encode notices so a newly opened document can warn again. */
export function clearEncodeWarningState(): void {
  toastedMessages.clear();
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
  toastedMessages.add(message);
  for (const warning of notable) {
    console.warn(`[varve encode] ${warning.code}: ${warning.message}`);
  }
  const notify = report ?? toastReporter;
  notify?.(message);
}

export function encodeDocumentJson(
  doc: Document,
  report?: (message: string) => void,
): { json: string; warnings: DocumentCodecWarning[] } {
  const encoded = DocumentCodec.encodeWithWarnings(doc);
  surfaceEncodeWarnings(encoded.warnings, report);
  return encoded;
}
