import type { AnalyticsExportFormat } from '@varve/shared';

export type DemoExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

type DemoExportListener = (format: DemoExportFormat) => void;

/**
 * Shared across Vite copies of this module. A module-level `let` is dropped
 * when the editor barrel and a direct file import evaluate twice, which is
 * what left /try sending launch events but no `demo-export-*` after a real
 * Inspector download.
 */
const LISTENER_KEY = Symbol.for('varve.demoExportAnalyticsListener');

type ListenerHost = typeof globalThis & {
  [LISTENER_KEY]?: DemoExportListener | null;
};

function getListener(): DemoExportListener | null {
  return (globalThis as ListenerHost)[LISTENER_KEY] ?? null;
}

/** Demo-only. Desktop release builds never register a listener. */
export function setDemoExportAnalyticsListener(next: DemoExportListener | null): void {
  (globalThis as ListenerHost)[LISTENER_KEY] = next;
}

export function notifyDemoExportAnalytics(format: AnalyticsExportFormat): void {
  if (format === 'png' || format === 'jpeg' || format === 'webp' || format === 'svg') {
    getListener()?.(format);
  }
}

/** Inspector / File-menu exports share this so cancelled saves send nothing. */
export function notifySuccessfulDemoExport(
  format: AnalyticsExportFormat | 'pdf' | string,
  cancelled = false,
): void {
  if (cancelled) return;
  if (format === 'png' || format === 'jpeg' || format === 'webp' || format === 'svg') {
    notifyDemoExportAnalytics(format);
  }
}

/** Batch export: one event per format, not per file. */
export function notifySuccessfulDemoExportBatch(
  formats: Iterable<AnalyticsExportFormat | string>,
): void {
  const seen = new Set<DemoExportFormat>();
  const listener = getListener();
  for (const format of formats) {
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp' && format !== 'svg') {
      continue;
    }
    if (seen.has(format)) continue;
    seen.add(format);
    listener?.(format);
  }
}
