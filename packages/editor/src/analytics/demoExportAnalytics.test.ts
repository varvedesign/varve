import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyDemoExportAnalytics,
  notifySuccessfulDemoExport,
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

  it('skips cancelled or unsupported inspector saves', () => {
    const listener = vi.fn();
    setDemoExportAnalyticsListener(listener);
    notifySuccessfulDemoExport('png', true);
    notifySuccessfulDemoExport('pdf');
    notifySuccessfulDemoExport('svg');
    expect(listener.mock.calls).toEqual([['svg']]);
  });
});
