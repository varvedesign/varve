import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureDesktopAnalytics,
  durationBucket,
  getDesktopAnalytics,
  hasConfiguredAnalyticsEndpoint,
  resetDesktopAnalyticsForTests,
  startDesktopFlushTimer,
  stopDesktopFlushTimer,
} from './desktopAnalytics';

const here = dirname(fileURLToPath(import.meta.url));

describe('desktop analytics removal', () => {
  beforeEach(() => {
    resetDesktopAnalyticsForTests();
    vi.restoreAllMocks();
  });

  it('never contacts Plausible or any usage endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const client = configureDesktopAnalytics({ platform: 'linux' });

    client.updateConsent({ website: 'granted', usage: 'granted', diagnostics: 'granted' });
    client.track('feature_used', { feature: 'pen' });
    client.track('app_launched', { surface: 'desktop' });
    await client.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasConfiguredAnalyticsEndpoint()).toBe(false);
  });

  it('keeps getDesktopAnalytics on the no-op client', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = getDesktopAnalytics();
    client.updateConsent({ website: 'granted', usage: 'granted', diagnostics: 'granted' });
    client.track('document_created', { source: 'blank' });
    await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no remaining desktop feature_used or Plausible wiring', () => {
    const sources = [
      resolve(here, 'desktopAnalytics.ts'),
      resolve(here, '../context.tsx'),
      resolve(here, '../components/Vectorize/VectorizeWorkflow.tsx'),
      resolve(here, '../../../../apps/desktop/src/App.tsx'),
      resolve(here, '../../../../apps/desktop/src-tauri/tauri.conf.json'),
    ];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toMatch(/feature_used/);
      expect(text).not.toMatch(/plausible\.io/i);
      expect(text).not.toMatch(/VITE_VARVE_ANALYTICS_/);
    }
  });

  describe('durationBucket', () => {
    it('buckets durations correctly', () => {
      expect(durationBucket(0)).toBe('under_16ms');
      expect(durationBucket(15)).toBe('under_16ms');
      expect(durationBucket(16)).toBe('16_33ms');
      expect(durationBucket(32)).toBe('16_33ms');
      expect(durationBucket(33)).toBe('33_50ms');
      expect(durationBucket(49)).toBe('33_50ms');
      expect(durationBucket(50)).toBe('50_100ms');
      expect(durationBucket(99)).toBe('50_100ms');
      expect(durationBucket(100)).toBe('100_250ms');
      expect(durationBucket(249)).toBe('100_250ms');
      expect(durationBucket(250)).toBe('over_250ms');
      expect(durationBucket(5000)).toBe('over_250ms');
    });
  });

  describe('flush timer', () => {
    it('starts and stops without error', () => {
      vi.useFakeTimers();
      startDesktopFlushTimer();
      stopDesktopFlushTimer();
      vi.useRealTimers();
    });

    it('is idempotent on start', () => {
      vi.useFakeTimers();
      startDesktopFlushTimer();
      startDesktopFlushTimer();
      stopDesktopFlushTimer();
      vi.useRealTimers();
    });
  });
});
