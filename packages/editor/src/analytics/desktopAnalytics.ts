import {
  AnalyticsClient,
  type AnalyticsConsent,
  type AnalyticsPlatform,
  DEFAULT_ANALYTICS_CONSENT,
  NoopAnalyticsProvider,
} from '@varve/shared';
import { getReleaseInfo } from '../crash/releaseInfo';
import type { PrivacySettingsStore } from '../settings';

let client: AnalyticsClient | null = null;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 30_000;

function consentFromSettings(settings: PrivacySettingsStore): AnalyticsConsent {
  return {
    website: 'denied',
    usage: 'denied',
    diagnostics: settings.diagnostics,
  };
}

function flushNow(): void {
  if (!client) return;
  void client.flush();
}

function handleBeforeUnload(): void {
  flushNow();
}

/**
 * Desktop usage analytics were removed. The client stays as a no-op so leftover
 * diagnostics call sites cannot contact a third-party endpoint.
 */
export function startDesktopFlushTimer(): void {
  if (flushIntervalId !== null) return;
  flushIntervalId = setInterval(flushNow, FLUSH_INTERVAL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload);
  }
}

export function stopDesktopFlushTimer(): void {
  if (flushIntervalId !== null) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
}

export function configureDesktopAnalytics(options?: {
  platform?: AnalyticsPlatform;
}): AnalyticsClient {
  const release = getReleaseInfo();
  client = new AnalyticsClient({
    context: {
      appVersion: release.appVersion,
      platform: options?.platform ?? 'unknown',
      runtime: 'desktop',
      releaseChannel: release.buildChannel,
    },
    consent: { ...DEFAULT_ANALYTICS_CONSENT, website: 'denied', usage: 'denied' },
    provider: new NoopAnalyticsProvider(),
  });
  return client;
}

/** Always false: desktop builds no longer ship a usage-analytics endpoint. */
export function hasConfiguredAnalyticsEndpoint(): boolean {
  return false;
}

export function getDesktopAnalytics(): AnalyticsClient {
  return client ?? configureDesktopAnalytics();
}

export function reportRendererFallback(
  renderer: 'canvas2d' | 'webgpu' | 'webgl2',
  detail: string,
): void {
  getDesktopAnalytics().track('renderer_fallback', {
    from: renderer === 'webgl2' ? 'webgl' : renderer,
    to: 'canvas2d',
    reason: /failed|unavailable|probe/i.test(detail) ? 'initialization_failed' : 'unavailable',
  });
}

export function updateDesktopAnalyticsConsent(settings: PrivacySettingsStore): void {
  getDesktopAnalytics().updateConsent(consentFromSettings(settings));
}

export function resetDesktopAnalyticsForTests(): void {
  client = null;
  stopDesktopFlushTimer();
}

export { DEFAULT_ANALYTICS_CONSENT };

/**
 * Bucket a millisecond duration into a low-cardinality analytics bucket.
 * The boundaries are deliberately coarse — they answer "fast / medium / slow"
 * without retaining numeric timing data.
 */
export function durationBucket(
  ms: number,
): 'under_16ms' | '16_33ms' | '33_50ms' | '50_100ms' | '100_250ms' | 'over_250ms' {
  if (ms < 16) return 'under_16ms';
  if (ms < 33) return '16_33ms';
  if (ms < 50) return '33_50ms';
  if (ms < 100) return '50_100ms';
  if (ms < 250) return '100_250ms';
  return 'over_250ms';
}
