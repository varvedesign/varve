import {
  type AnalyticsEvent,
  type AnalyticsEventMap,
  type AnalyticsProvider,
  campaignCountQuery,
  pathWithCampaign,
  safeGoatCounterDomain,
} from '@varve/shared';

export {
  campaignCountQuery,
  pathWithCampaign,
  safeGoatCounterDomain,
  VARVE_GOATCOUNTER_DOMAIN,
  WEBSITE_CAMPAIGN_REF,
  websiteCampaignRef,
  websiteReferrer,
} from '@varve/shared';

interface GoatCounterOptions {
  domain: string;
  canSend: () => boolean;
  route: () => string;
  referrer: () => string;
  search?: () => string;
  fetchImpl?: typeof fetch;
}

/**
 * Aggregate website-only transport. No remote script, browser fingerprint, session,
 * screen dimensions, page title, persistent ID or design content. The only query
 * forwarded is an allowlisted first-party `ref` campaign tag: pageviews send it
 * as GoatCounter `q` (`?ref=tag`), which becomes a Campaign-scheme referrer.
 * Events keep the tag on the event path because GoatCounter ignores `q` there.
 * The account MUST have Sessions and Individual pageviews disabled before activation.
 * GoatCounter's documented /count transport is only used from the visitor's browser.
 */
export class GoatCounterProvider implements AnalyticsProvider {
  private readonly endpoint: string | null;
  private readonly options: GoatCounterOptions;
  private readonly pending: AnalyticsEvent[] = [];
  private readonly active = new Set<AbortController>();

  constructor(options: GoatCounterOptions) {
    this.options = options;
    const domain = safeGoatCounterDomain(options.domain);
    this.endpoint = domain ? `https://${domain}/count` : null;
  }

  async initialize(): Promise<void> {}

  track(event: AnalyticsEvent): void {
    if (
      this.endpoint &&
      this.options.canSend() &&
      event.category === 'website' &&
      (event.name === 'website_page_viewed' ||
        event.name === 'website_download_started' ||
        event.name === 'browser_demo_desktop_download' ||
        event.name === 'browser_demo_launched') &&
      this.pending.length < 25
    ) {
      this.pending.push(event);
    }
  }

  async flush(): Promise<void> {
    const events = this.pending.splice(0);
    if (!this.endpoint || !this.options.canSend()) return;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    for (const event of events) {
      if (!this.options.canSend()) return;
      const pageview = event.name === 'website_page_viewed';
      const demoLaunch = event.name === 'browser_demo_launched';
      const search = this.options.search?.() ?? '';
      const path = pageview
        ? (event.payload as AnalyticsEventMap['website_page_viewed']).route
        : pathWithCampaign(
            demoLaunch
              ? this.demoLaunchPath(event.payload as AnalyticsEventMap['browser_demo_launched'])
              : this.downloadPath(event.payload as AnalyticsEventMap['website_download_started']),
            search,
          );
      const url = new URL(this.endpoint);
      url.searchParams.set('p', path);
      url.searchParams.set('ns', 'true');
      if (!pageview) {
        url.searchParams.set('e', 'true');
      } else {
        // Hit.Defaults overwrites r when q has ref/utm_source/src/source.
        const query = campaignCountQuery(search);
        if (query) url.searchParams.set('q', query);
      }
      const referrer = pageview ? this.options.referrer() : '';
      if (referrer) url.searchParams.set('r', referrer);
      const controller = new AbortController();
      this.active.add(controller);
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        // POST avoids cache-based undercounts without a per-hit random identifier.
        // No cookies or page URL Referer are sent to the provider.
        await fetchImpl(url.toString(), {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          keepalive: true,
          signal: controller.signal,
        });
      } catch {
        // Never retry tracking: uncertainty must not inflate counts or break downloads.
      } finally {
        clearTimeout(timer);
        this.active.delete(controller);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.pending.length = 0;
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }

  private downloadPath(payload: AnalyticsEventMap['website_download_started']): string {
    // Input comes from AnalyticsClient's closed, sanitized website event schema.
    return [
      'website_download_clicked',
      this.options.route(),
      payload.platform,
      payload.architecture,
      payload.packageType,
      payload.release,
      payload.releaseChannel ?? 'unknown',
    ].join('|');
  }

  private demoLaunchPath(payload: AnalyticsEventMap['browser_demo_launched']): string {
    // Demo launch event: entry point is either 'website' or 'direct'
    return `demo-launch-${payload.entry}`;
  }
}
