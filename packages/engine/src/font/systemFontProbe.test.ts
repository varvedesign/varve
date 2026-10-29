// @vitest-environment jsdom

/**
 * Host font availability probe.
 *
 * The defect these tests lock down: the registry's seed list asserts that
 * common system families exist, and `availableFamilies()` projected the
 * registered map without ever checking the host. A document using an absent
 * family therefore painted the CSS fallback while every availability surface
 * reported the typography as faithful.
 *
 * `document.fonts.check()` cannot fix it — measured in Chromium on 2026-10-21
 * it reports `true` for a nonexistent family, because it answers "is anything
 * pending" rather than "does this family exist". The probe measures instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeResolvedFamilies, setFontAvailabilityProbeForTest } from './systemFontProbe';

/** Width per character the fake host resolves, keyed by family then generic. */
type HostFonts = Record<string, Record<string, number>>;

const PROBE_LENGTH = 'mmmmmmmmmmlliWMQ@#'.length;

/**
 * Install a fake canvas whose measured width depends on the first family in
 * the font shorthand that the fake host knows about. An unknown family
 * contributes no glyphs, so the generic fallback decides — exactly the
 * behaviour a real engine has for an absent family.
 */
function installFakeCanvas(host: HostFonts): { measuredFonts: string[] } {
  const measuredFonts: string[] = [];
  const fakeContext = {
    font: '',
    measureText: () => {
      measuredFonts.push(fakeContext.font);
      const family = /^\d+px "([^"]+)"/.exec(fakeContext.font)?.[1] ?? '';
      const generic = /(monospace|serif|sans-serif)\s*$/.exec(fakeContext.font)?.[1] ?? 'serif';
      const perChar = host[family]?.[generic] ?? host.__generic__?.[generic] ?? 1;
      return { width: perChar * PROBE_LENGTH };
    },
  };
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas'
      ? ({ getContext: () => fakeContext } as unknown as HTMLElement)
      : original(tag)) as typeof document.createElement);
  return { measuredFonts };
}

const HOST: HostFonts = {
  __generic__: { monospace: 7, serif: 8, 'sans-serif': 9 },
  'Known Sans': { monospace: 11, serif: 11, 'sans-serif': 11 },
  // Coincides with the monospace fallback's metrics but not the others.
  'Partial Sans': { monospace: 7, serif: 12, 'sans-serif': 13 },
};

afterEach(() => {
  vi.restoreAllMocks();
  setFontAvailabilityProbeForTest(null);
});

describe('probeResolvedFamilies', () => {
  it('reports only families whose width differs from a generic fallback', () => {
    installFakeCanvas(HOST);

    const resolved = probeResolvedFamilies(['Known Sans', 'Absent Family']);

    expect(resolved).not.toBeNull();
    expect(resolved?.has('Known Sans')).toBe(true);
    expect(resolved?.has('Absent Family')).toBe(false);
  });

  it('accepts a family that coincides with one generic but not the others', () => {
    // The safe direction: one metric coincidence must not mark a real font
    // missing, because a spurious missing-font dialog is the failure users
    // notice.
    installFakeCanvas(HOST);

    const resolved = probeResolvedFamilies(['Partial Sans']);

    expect(resolved?.has('Partial Sans')).toBe(true);
  });

  it('establishes a baseline for every generic before judging a candidate', () => {
    const { measuredFonts } = installFakeCanvas(HOST);

    probeResolvedFamilies(['Absent Family']);

    // An absent family differs from no baseline, so all three are consulted.
    for (const generic of ['monospace', 'serif', 'sans-serif']) {
      expect(
        measuredFonts.some(
          (font) => font.includes('__varve_font_probe_absent_family__') && font.endsWith(generic),
        ),
      ).toBe(true);
    }
  });

  it('answers null, not "none", when the canvas does not shape text', () => {
    installFakeCanvas({ __generic__: { monospace: 0, serif: 0, 'sans-serif': 0 } });

    expect(probeResolvedFamilies(['Arial', 'Meiryo'])).toBeNull();
  });

  it('answers null when there is no measurable canvas at all', () => {
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas'
        ? ({ getContext: () => null } as unknown as HTMLElement)
        : original(tag)) as typeof document.createElement);

    expect(probeResolvedFamilies(['Arial'])).toBeNull();
  });

  it('answers null for an empty candidate list rather than an empty verdict', () => {
    expect(probeResolvedFamilies([])).toBeNull();
  });
});
