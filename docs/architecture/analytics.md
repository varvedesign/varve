# Privacy-first analytics architecture

Varve analytics exists to answer a small set of product questions, not to
observe creative work. The implementation is provider-neutral and disabled by
default where no approved endpoint is configured.

## Invariants

1. Unknown consent is equivalent to denied consent for sending.
2. Website analytics, product usage, diagnostics telemetry, and crash reporting
   are separate categories. Crash reporting uses the existing `@varve/crash`
   system and is never enabled by an analytics preference.
3. Events are registered in `packages/shared/src/analytics/schema.ts`.
4. Runtime validation accepts only the exact fields for a registered event.
5. Event values are closed enums or bounded safe release/version strings.
6. A denylist rejects document and identity-shaped keys as defense in depth.
7. The queue is bounded and memory-only; it is not a second local document store.
8. Providers are asynchronous and failures are swallowed at the analytics
   boundary. Analytics cannot block startup, editing, save, export, or
   navigation.
9. No autocapture, DOM capture, session replay, screen recording, canvas
   fingerprinting, advertising ID, or persistent hardware identifier exists.

## Consent

The desktop app sends no usage stats. Leftover `privacy.diagnostics` keys may
still persist in settings; the desktop app ignores them for transmission. The
existing crash UI keeps its own versioned consent state. Website and browser-demo
consent share `varve:website-analytics-consent:goatcounter-v1`. GPC and DNT fail
closed for those surfaces.

Revocation updates the client immediately, drops queued events in revoked
categories, and shuts down the provider when no category remains granted.

## Provider boundary

Feature code uses `AnalyticsClient.track(name, payload)`. It never imports a
vendor. `NoopAnalyticsProvider` is the default. `HttpAnalyticsProvider` exists
for a future Varve-owned aggregate endpoint and accepts only HTTPS endpoints.

The website and the `/try` browser demo send consented counts to GoatCounter
only after the visitor clicks Allow. There is no remote analytics script.
Automatic pageviews, file-download, outbound-link, and form-submission capture
are disabled; Varve sends only the manually normalized events listed in
`docs/privacy/analytics.md`. Denied, unknown, DNT, and GPC states send nothing.

The production desktop app sends no usage analytics. There is no desktop
collector and no `VITE_VARVE_ANALYTICS_DOMAIN` wiring. Stored leftover consent
keys are ignored.

## Adding an event

Before adding an event, answer all of these questions in the measurement plan:

- What product decision will this event enable?
- Which consent category owns it?
- Could any field contain creative content, a path, an identity, or a high-
  cardinality value?
- Can a bucket or enum answer the question instead?
- What is the operational retention period?
- Is the public disclosure and privacy test updated?

Then add an exact field definition, runtime validator coverage, a focused privacy
test, and documentation. Do not call a provider directly or attach analytics to
serialization, rendering, pointer-move, keystroke, or frame loops.
