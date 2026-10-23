// @vitest-environment jsdom

import { notifyDemoExportAnalytics } from '@varve/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canSendDemoAnalytics,
  demoAnalyticsTransportAllowed,
  readDemoAnalyticsChoice,
  resetDemoAnalyticsForTests,
  setDemoAnalyticsChoice,
  setDemoAnalyticsConfiguredDomainForTests,
  startDemoAnalytics,
  trackDemoDownloadClick,
  trackDemoExport,
  trackDemoLaunched,
  WEBSITE_ANALYTICS_CONSENT_KEY,
} from './demoAnalytics';

function collectorPath(input: unknown): string | null {
  return new URL(String(input)).searchParams.get('p');
}

function collectorQuery(input: unknown): Record<string, string> {
  return Object.fromEntries(new URL(String(input)).searchParams);
}

beforeEach(() => {
  resetDemoAnalyticsForTests();
  setDemoAnalyticsConfiguredDomainForTests('varve.studio');
  localStorage.clear();
  window.history.replaceState({}, '', '/try/');
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 202 }));
});

afterEach(() => {
  resetDemoAnalyticsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('demo GoatCounter analytics', () => {
  it('sends nothing while consent is unknown, denied, or blocked by DNT/GPC', async () => {
    await trackDemoLaunched();
    expect(fetch).not.toHaveBeenCalled();

    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'denied');
    resetDemoAnalyticsForTests();
    await trackDemoLaunched();
    expect(fetch).not.toHaveBeenCalled();

    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'granted');
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    resetDemoAnalyticsForTests();
    await trackDemoLaunched();
    expect(fetch).not.toHaveBeenCalled();
    expect(readDemoAnalyticsChoice()).toBe('denied');
    expect(canSendDemoAnalytics()).toBe(false);

    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    resetDemoAnalyticsForTests();
    await trackDemoLaunched();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends one launch page view and demo-launch-direct after a grant', async () => {
    window.history.replaceState({}, '', '/try/?ref=hn-post');
    await setDemoAnalyticsChoice('granted');
    expect(localStorage.getItem(WEBSITE_ANALYTICS_CONSENT_KEY)).toBe('granted');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(collectorPath(vi.mocked(fetch).mock.calls[0]![0])).toBe('try');
    expect(collectorQuery(vi.mocked(fetch).mock.calls[0]![0])).toMatchObject({
      p: 'try',
      ns: 'true',
      q: '?ref=hn-post',
    });
    expect(collectorQuery(vi.mocked(fetch).mock.calls[0]![0]).e).toBeUndefined();
    expect(collectorQuery(vi.mocked(fetch).mock.calls[1]![0])).toEqual({
      p: 'demo-launch-direct',
      ns: 'true',
      e: 'true',
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).not.toContain('filename');
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).not.toMatch(/layer|document|size/i);
  });

  it('records a bare try path when ref is not allowlisted', async () => {
    window.history.replaceState({}, '', '/try/?ref=evil');
    await setDemoAnalyticsChoice('granted');
    expect(collectorPath(vi.mocked(fetch).mock.calls[0]![0])).toBe('try');
    expect(collectorQuery(vi.mocked(fetch).mock.calls[0]![0]).q).toBeUndefined();
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).not.toContain('evil');
  });

  it('sends export format events and a download click with no document data', async () => {
    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'granted');
    await trackDemoExport('png');
    await trackDemoExport('svg');
    await trackDemoExport('pdf');
    await trackDemoDownloadClick();
    const paths = vi.mocked(fetch).mock.calls.map((call) => collectorPath(call[0]));
    expect(paths).toEqual(['demo-export-png', 'demo-export-svg', 'demo-download-click']);
    for (const [request] of vi.mocked(fetch).mock.calls) {
      expect(String(request)).not.toContain('Poster');
      expect(String(request)).not.toContain('.varve');
      expect(String(request)).not.toMatch(/filename|layer|text=/i);
    }
  });

  it('forwards editor export notifications to GoatCounter in demo mode', async () => {
    window.history.replaceState({}, '', '/try/?try=1');
    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'granted');
    startDemoAnalytics();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    notifyDemoExportAnalytics('png');
    await vi.waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.map((call) => collectorPath(call[0]))).toContain(
        'demo-export-png',
      ),
    );
  });

  it('does not send from a non-demo page even with granted consent', async () => {
    window.history.replaceState({}, '', '/');
    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'granted');
    startDemoAnalytics();
    await trackDemoLaunched();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends nothing from local, preview, or fork hosts without the production switch', async () => {
    setDemoAnalyticsConfiguredDomainForTests('');
    localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, 'granted');
    await trackDemoLaunched();
    await trackDemoExport('png');
    expect(fetch).not.toHaveBeenCalled();
    expect(demoAnalyticsTransportAllowed('localhost', '')).toBe(false);
    expect(demoAnalyticsTransportAllowed('example.github.io', '')).toBe(false);
    expect(demoAnalyticsTransportAllowed('varve.studio', '')).toBe(true);
    expect(demoAnalyticsTransportAllowed('localhost', 'varve.studio')).toBe(true);
    expect(demoAnalyticsTransportAllowed('localhost', 'other.example')).toBe(false);
  });

  it('honors DNT even if the visitor clicks Allow', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    await setDemoAnalyticsChoice('granted');
    expect(readDemoAnalyticsChoice()).toBe('denied');
    expect(fetch).not.toHaveBeenCalled();
  });
});
