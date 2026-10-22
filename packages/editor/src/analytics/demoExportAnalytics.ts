import type { AnalyticsExportFormat } from '@varve/shared';

export type DemoExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

type DemoExportListener = (format: DemoExportFormat) => void;

let listener: DemoExportListener | null = null;

/** Demo-only. Desktop release builds never register a listener. */
export function setDemoExportAnalyticsListener(next: DemoExportListener | null): void {
  listener = next;
}

export function notifyDemoExportAnalytics(format: AnalyticsExportFormat): void {
  if (format === 'png' || format === 'jpeg' || format === 'webp' || format === 'svg') {
    listener?.(format);
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
