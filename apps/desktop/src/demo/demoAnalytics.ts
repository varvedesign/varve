/**
 * Demo-mode GoatCounter transport for /try.
 *
 * Same collector, consent key, DNT/GPC rules, and campaign-ref allowlist as
 * the website. Desktop / Tauri builds never activate demo mode, so they send
 * nothing. Payloads are path-only: no layer names, text, filenames, sizes, or
 * document data.
 */

import { setDemoExportAnalyticsListener } from '@varve/editor';
import { pathWithCampaign, safeGoatCounterDomain, VARVE_GOATCOUNTER_DOMAIN } from '@varve/shared';
import { demoMode } from './demoMode';

export const WEBSITE_ANALYTICS_CONSENT_KEY = 'varve:website-analytics-consent:goatcounter-v1';
const LEGACY_CONSENT_KEY = 'varve:website-analytics-consent';

export type DemoAnalyticsChoice = 'unknown' | 'granted' | 'denied';
export type DemoExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

const EXPORT_FORMATS = new Set<string>(['png', 'jpeg', 'webp', 'svg']);

let launchSent = false;
let started = false;

function privacySignalBlocks(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

function collectorEndpoint(): string | null {
  const domain = safeGoatCounterDomain(VARVE_GOATCOUNTER_DOMAIN);
  return domain ? `https://${domain}/count` : null;
}

export function readDemoAnalyticsChoice(): DemoAnalyticsChoice {
  if (privacySignalBlocks()) return 'denied';
  try {
    const value = window.localStorage.getItem(WEBSITE_ANALYTICS_CONSENT_KEY);
    if (value === 'granted' || value === 'denied') return value;
    return window.localStorage.getItem(LEGACY_CONSENT_KEY) === 'denied' ? 'denied' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function writeDemoAnalyticsChoice(value: DemoAnalyticsChoice): void {
  try {
    if (value === 'unknown') window.localStorage.removeItem(WEBSITE_ANALYTICS_CONSENT_KEY);
    else window.localStorage.setItem(WEBSITE_ANALYTICS_CONSENT_KEY, value);
  } catch {
    // Storage restrictions fail closed; in-memory sending still requires granted.
  }
}

export function canSendDemoAnalytics(): boolean {
  return (
    Boolean(demoMode().active) && readDemoAnalyticsChoice() === 'granted' && !privacySignalBlocks()
  );
}

function goatPath(path: string): string {
  return path.replace(/^\/+/, '');
}

async function sendCount(path: string, event: boolean): Promise<void> {
  const endpoint = collectorEndpoint();
  if (!endpoint || !canSendDemoAnalytics()) return;
  const url = new URL(endpoint);
  url.searchParams.set('p', goatPath(path));
  url.searchParams.set('ns', 'true');
  if (event) url.searchParams.set('e', 'true');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url.toString(), {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      signal: controller.signal,
    });
  } catch {
    // Never retry tracking: uncertainty must not inflate counts.
  } finally {
    clearTimeout(timer);
  }
}

function searchFromLocation(): string {
  try {
    return window.location.search;
  } catch {
    return '';
  }
}

export async function trackDemoLaunched(): Promise<void> {
  if (launchSent || !canSendDemoAnalytics()) return;
  launchSent = true;
  const page = pathWithCampaign('try', searchFromLocation());
  await sendCount(page, false);
  await sendCount('demo-launch-direct', true);
}

export async function trackDemoExport(format: string): Promise<void> {
  if (!EXPORT_FORMATS.has(format) || !canSendDemoAnalytics()) return;
  await sendCount(`demo-export-${format}`, true);
}

export async function trackDemoDownloadClick(): Promise<void> {
  if (!canSendDemoAnalytics()) return;
  await sendCount('demo-download-click', true);
}

export async function setDemoAnalyticsChoice(choice: 'granted' | 'denied'): Promise<void> {
  const next = privacySignalBlocks() ? 'denied' : choice;
  writeDemoAnalyticsChoice(next);
  if (next === 'granted') await trackDemoLaunched();
}

export function startDemoAnalytics(): void {
  if (!demoMode().active || started) return;
  started = true;
  setDemoExportAnalyticsListener((format) => {
    void trackDemoExport(format);
  });
  void trackDemoLaunched();
}

export function resetDemoAnalyticsForTests(): void {
  launchSent = false;
  started = false;
  setDemoExportAnalyticsListener(null);
}
