/**
 * Host font availability probe.
 *
 * `FontRegistry` seeds a list of "system" families (Arial, Helvetica, Meiryo,
 * Noto Sans CJK, …) so a fresh document has something to resolve. Those seeds
 * are assertions about the host, and nothing verified them: `availableFamilies`
 * is a projection of the registered map, so the missing-font sweep treated
 * every seeded family as installed. On a host without one of them the canvas
 * painted the CSS fallback chain while preflight, the Missing Fonts dialog, and
 * the export preflight all reported the typography as faithful.
 *
 * Why not `document.fonts.check()`
 * --------------------------------
 * It cannot answer this question. Measured in Chromium on 2026-10-21, a
 * deliberately absurd family ("Zzqqx No Such Family 9000") reports
 * `check() === true`: the API reports a pending load for a *declared* face and
 * otherwise answers "nothing is pending", which for a family with no
 * `@font-face` rule at all is indistinguishable from "installed". Every
 * candidate in that run reported `true`, including families the host does not
 * have. A probe built on it would confirm every seed and change nothing.
 * (`check()` is still the right call for its actual job — waiting for a
 * declared face to finish loading, as the demo's font preload does — it simply
 * carries no information about host-installed families.)
 *
 * What is measured instead: an unknown family contributes no glyphs, so a
 * string measured with `"<family>", <generic>` is exactly as wide as the same
 * string measured with only the generic. A family counts as resolved when its
 * width differs from the fallback for **any** generic. That direction is the
 * safe one: a real font yields one width, and the three generic baselines are
 * three different widths, so it cannot coincide with all of them — while a
 * font that happens to match one baseline still differs from the others. The
 * reverse rule (require all three to differ) would mark a real font missing
 * whenever one metric coincidence occurred, which is the failure users notice.
 * The same run resolved the host correctly (DejaVu Sans, Carlito, Fira Sans
 * present; Inter, Noto Sans CJK, Meiryo absent).
 *
 * Unknown is a real answer. Without a canvas, or where the canvas does not
 * shape glyphs at all (jsdom, a worker before fonts load), every candidate
 * measures identically and the probe reports `null` — callers then keep their
 * previous behaviour rather than declaring the whole seed list missing.
 */

/** A probe families string; long enough that metric coincidences are unlikely. */
const PROBE_TEXT = 'mmmmmmmmmmlliWMQ@#';

/** Generics a family could silently fall back to, one at a time. */
const GENERIC_FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const;

/** A family that must never exist; establishes each generic's own width. */
const SENTINEL_FAMILY = '__varve_font_probe_absent_family__';

/** A font size large enough that sub-pixel rounding does not mask a difference. */
const PROBE_SIZE_PX = 72;

type MeasureContext = {
  measureText(text: string): { width: number };
  font: string;
};

/**
 * Acquire a 2D context that can shape text, or null when this environment
 * cannot answer.
 */
function acquireMeasureContext(): MeasureContext | null {
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext?.('2d') as MeasureContext | null;
      if (ctx && typeof ctx.measureText === 'function') return ctx;
    }
    const OffscreenCanvasCtor = (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas })
      .OffscreenCanvas;
    if (OffscreenCanvasCtor) {
      const canvas = new OffscreenCanvasCtor(4, 4);
      const ctx = canvas.getContext('2d') as unknown as MeasureContext | null;
      if (ctx && typeof ctx.measureText === 'function') return ctx;
    }
  } catch {
    // Tainted or unavailable canvas: treat as "cannot verify".
  }
  return null;
}

/**
 * Probe which of `families` the host can actually resolve.
 *
 * @returns the subset the host resolves. `null` when this environment cannot
 *   measure text, which callers must treat as "unknown", never as "none".
 */
export function probeResolvedFamilies(families: Iterable<string>): Set<string> | null {
  const candidates = [...new Set(families)];
  if (candidates.length === 0) return null;

  const ctx = acquireMeasureContext();
  if (!ctx) return null;

  const measure = (font: string): number => {
    ctx.font = font;
    return ctx.measureText(PROBE_TEXT).width;
  };

  const quote = (family: string) => `"${family.replace(/"/g, '')}"`;
  const baseline = new Map<string, number>();
  for (const generic of GENERIC_FALLBACKS) {
    baseline.set(generic, measure(`${PROBE_SIZE_PX}px ${quote(SENTINEL_FAMILY)}, ${generic}`));
  }

  // No shaping at all: every width is zero, so the measurement carries no
  // information and a verdict would be a guess.
  if ([...baseline.values()].every((width) => !(width > 0))) return null;

  const resolved = new Set<string>();
  for (const family of candidates) {
    const differsFromSomeFallback = GENERIC_FALLBACKS.some((generic) => {
      const withFamily = measure(`${PROBE_SIZE_PX}px ${quote(family)}, ${generic}`);
      const withoutFamily = baseline.get(generic) ?? Number.NaN;
      if (!(withFamily > 0) || !(withoutFamily > 0)) return false;
      return Math.abs(withFamily - withoutFamily) > 0.01;
    });
    if (differsFromSomeFallback) resolved.add(family);
  }
  return resolved;
}

/**
 * Test seam: replace the probe (returns null to disable it).
 *
 * Availability is a host property, so tests that assert missing-font behaviour
 * need to state the host's answer rather than inherit the CI machine's fonts.
 */
let activeProbe: typeof probeResolvedFamilies = probeResolvedFamilies;

export function probeResolvedFamiliesWithOverride(families: Iterable<string>): Set<string> | null {
  return activeProbe(families);
}

export function setFontAvailabilityProbeForTest(probe: typeof probeResolvedFamilies | null): void {
  activeProbe = probe ?? probeResolvedFamilies;
}
