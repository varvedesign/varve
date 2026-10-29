import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyDemoExportAnalytics,
  notifySuccessfulDemoExport,
  notifySuccessfulDemoExportBatch,
  setDemoExportAnalyticsListener,
} from './demoExportAnalytics';

afterEach(() => {
  setDemoExportAnalyticsListener(null);
});

describe('demo export analytics sink', () => {
  it('forwards only png, jpeg, webp, and svg', () => {
    const listener = vi.fn();
    setDemoExportAnalyticsListener(listener);
    notifyDemoExportAnalytics('png');
    notifyDemoExportAnalytics('svg');
    notifyDemoExportAnalytics('pdf');
    notifyDemoExportAnalytics('gif');
    expect(listener.mock.calls).toEqual([['png'], ['svg']]);
  });

  it('does nothing when no listener is registered', () => {
    expect(() => notifyDemoExportAnalytics('png')).not.toThrow();
  });

  it('reads the listener from the shared globalThis registry', () => {
    const listener = vi.fn();
    const host = globalThis as typeof globalThis & {
      [key: symbol]: ((format: 'png') => void) | null | undefined;
    };
    host[Symbol.for('varve.demoExportAnalyticsListener')] = listener;
    notifyDemoExportAnalytics('png');
    expect(listener).toHaveBeenCalledWith('png');
  });

  it('skips cancelled or unsupported inspector saves', () => {
    const listener = vi.fn();
    setDemoExportAnalyticsListener(listener);
    notifySuccessfulDemoExport('png', true);
    notifySuccessfulDemoExport('pdf');
    notifySuccessfulDemoExport('svg');
    expect(listener.mock.calls).toEqual([['svg']]);
  });

  it('sends one event per format in a batch, not per file', () => {
    const listener = vi.fn();
    setDemoExportAnalyticsListener(listener);
    notifySuccessfulDemoExportBatch(['png', 'png', 'svg', 'pdf', 'png', 'jpeg']);
    expect(listener.mock.calls).toEqual([['png'], ['svg'], ['jpeg']]);
  });
});
