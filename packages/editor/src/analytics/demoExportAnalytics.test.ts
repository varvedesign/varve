import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyDemoExportAnalytics, setDemoExportAnalyticsListener } from './demoExportAnalytics';

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
});
