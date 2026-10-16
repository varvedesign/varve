/**
 * Tests for the ICC proof provider.
 *
 * Two failure classes this guards against:
 *
 * 1. Presenting a proof condition Varve cannot reproduce. The proof-profile
 *    menus offer several press conditions, but the render engine bundles exactly
 *    one real CMYK output profile. Proofing "GRACoL" with FOGRA39 bytes under a
 *    GRACoL label is worse than refusing: the user cannot tell that the target
 *    was wrong.
 * 2. Claiming proofing is active when no transform exists. The soft-proof
 *    toggle previously changed nothing on the canvas because no converter was
 *    ever registered for any profile id.
 *
 * The batched frame path is exercised through an injected fake engine, so these
 * run without a browser, a worker, or a WASM artifact.
 */

import type { ProofConfig } from '@varve/scene';
import { isProofingAvailable } from '@varve/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProofToFrame,
  ensureProofProvider,
  proofProviderStatus,
  resetProofProviderForTests,
  setProofEngineForTests,
} from './proofProvider';

function proofConfig(patch: Partial<ProofConfig> = {}): ProofConfig {
  return {
    profileId: 'fogra39',
    profileName: 'Fogra39 (ISO Coated v2 300%)',
    renderingIntent: 'relative',
    blackPointCompensation: true,
    simulatePaperColor: false,
    simulateBlackInk: false,
    gamutWarning: { enabled: false, opacity: 0.4 },
    ...patch,
  };
}

afterEach(() => {
  resetProofProviderForTests();
  vi.unstubAllGlobals();
});

describe('proof provider availability', () => {
  it('rejects a proof condition it has no ICC profile for, rather than proofing against another', async () => {
    const status = await ensureProofProvider(proofConfig({ profileId: 'gracol2006' }));

    expect(status.available).toBe(false);
    expect(status.reason).toContain('gracol2006');
    expect(status.outputProfileName).toBeUndefined();
  });

  it('reports unavailability when the colour WASM module cannot be loaded', async () => {
    // No module is served in the unit-test environment.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );

    const status = await ensureProofProvider(proofConfig());
    expect(status.available).toBe(false);
    expect(status.reason).toBeDefined();
    expect(proofProviderStatus().available).toBe(false);
  });

  it('does not claim a proofing capability for an unregistered condition', () => {
    // Nothing has been registered at this point in the suite.
    expect(isProofingAvailable(proofConfig())).toBe(false);
  });
});

/** A fake engine recording what it was asked, applying an observable mapping. */
function fakeEngine(
  options: { outOfGamut?: (index: number) => boolean; throwOnProof?: boolean } = {},
) {
  const calls: Array<{ n: number; gamutCheck: boolean }> = [];
  const engine = {
    set_display_profile: () => undefined,
    set_output_profile: () => undefined,
    display_profile_fingerprint: () => '0'.repeat(16),
    output_profile_fingerprint: () => 'f'.repeat(16),
    proof_pixel: () => new Float32Array([0, 0, 0]),
    proof_buffer: (rgb: Float32Array, _i: string, _b: boolean, _p: boolean, gamut: boolean) => {
      if (options.throwOnProof) throw new Error('transform failed');
      const n = rgb.length / 3;
      calls.push({ n, gamutCheck: gamut });
      const out = new Float32Array(rgb.length);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          // "Proofed" value: inverted, so a change is observable.
          out[i * 3 + c] = gamut && options.outOfGamut?.(i) ? ALARM : 1 - (rgb[i * 3 + c] ?? 0);
        }
      }
      return out;
    },
    is_out_of_gamut: () => false,
    total_area_coverage: () => 324.86,
    simulation_support: () => new Uint8Array([1, 1, 1, 0]),
    cached_transform_count: () => 1,
    retained_profile_bytes: () => 0,
  };
  return { engine, calls };
}

/** lcms2's default alarm colour on the 16-bit scale. */
const ALARM = 0x7f00 / 65535;

/** A frame with a solid fill, a gradient stop, a stroke and a rich-text run. */
function frameWithFourColours() {
  return [
    {
      id: 'n1',
      fill: { space: 'rgb', bitDepth: 'uint8', r: 255, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'gradient',
          stops: [
            { offset: 0, color: { space: 'rgb', bitDepth: 'uint8', r: 0, g: 255, b: 0, a: 255 } },
          ],
        },
      ],
      strokes: [{ color: { space: 'rgb', bitDepth: 'uint8', r: 0, g: 0, b: 255, a: 255 } }],
      primitive: {
        kind: 'text',
        richText: {
          paragraphs: [
            {
              runs: [
                {
                  text: 'x',
                  format: {
                    color: { space: 'rgb', bitDepth: 'uint8', r: 255, g: 255, b: 255, a: 255 },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  ] as unknown as Parameters<typeof applyProofToFrame>[0];
}

describe('applyProofToFrame', () => {
  it('is a no-op while proofing is unavailable, and never invents proofed colours', () => {
    const items = [{ id: 'a' }, { id: 'b' }] as unknown as Parameters<typeof applyProofToFrame>[0];

    // Disabled: identical array identity, so callers can skip downstream work.
    expect(applyProofToFrame(items, null)).toBe(items);
    // Enabled but unavailable: still identical, rather than a silent
    // second-best conversion.
    expect(applyProofToFrame(items, proofConfig())).toBe(items);
  });

  it('transforms every colour of the frame in one batched call', () => {
    const { engine, calls } = fakeEngine();
    setProofEngineForTests(engine);

    const items = frameWithFourColours();
    const out = applyProofToFrame(items, proofConfig());

    // One call carrying all four colours, with no gamut pass.
    expect(calls).toEqual([{ n: 4, gamutCheck: false }]);
    // The fake engine inverts, so red (255,0,0) -> (0,1,1) and the stroke's
    // blue (0,0,255) -> (1,1,0). Asserting the actual values (rather than that
    // "something changed") is what caught the walker's field mapping.
    const fill = (out[0] as unknown as { fill: { r: number; g: number; b: number } }).fill;
    expect(fill).toMatchObject({ r: 0, g: 1, b: 1 });
    // Alpha is coverage, not colour: it must survive the transform untouched.
    expect(fill).toMatchObject({ a: 255 });
    const stroke = (
      out[0] as unknown as { strokes: Array<{ color: { r: number; g: number; b: number } }> }
    ).strokes[0]?.color;
    expect(stroke).toMatchObject({ r: 1, g: 1, b: 0 });
    // The source document colours are untouched.
    expect((items[0] as unknown as { fill: { r: number } }).fill.r).toBe(255);
    expect(out).not.toBe(items);
  });

  it('drops the source profile from proofed colours, so replay cannot re-transform them', () => {
    const { engine } = fakeEngine();
    setProofEngineForTests(engine);

    const items = frameWithFourColours();
    (items[0] as unknown as { fill: { profile?: string } }).fill.profile = 'display-p3';
    const out = applyProofToFrame(items, proofConfig());

    expect((out[0] as unknown as { fill: { profile?: string } }).fill.profile).toBeUndefined();
  });

  it('falls back to the unproofed frame when the engine throws', () => {
    const { engine } = fakeEngine({ throwOnProof: true });
    setProofEngineForTests(engine);

    const items = frameWithFourColours();
    expect(applyProofToFrame(items, proofConfig())).toBe(items);
  });

  it('marks out-of-gamut colours and leaves in-gamut colours proofed', () => {
    const { engine, calls } = fakeEngine({ outOfGamut: (i) => i === 0 });
    setProofEngineForTests(engine);

    const out = applyProofToFrame(frameWithFourColours(), proofConfig(), {
      enabled: true,
      opacity: 0.4,
    });

    // A second call asked for the gamut pipeline over the same buffer.
    expect(calls).toEqual([
      { n: 4, gamutCheck: false },
      { n: 4, gamutCheck: true },
    ]);

    const item = out[0] as unknown as {
      fill: { r: number; g: number; b: number };
      strokes: Array<{ color: { r: number; g: number; b: number } }>;
    };
    // Out of gamut: every channel moves 40% of the way from its proofed value
    // to the alarm colour. The fake engine inverts, so red (255,0,0) proofed
    // is (0,1,1) and each channel lands at proofed + (alarm - proofed) * 0.4.
    const mixToward = (proofed: number, opacity: number) => proofed + (ALARM - proofed) * opacity;
    expect(item.fill.r).toBeCloseTo(mixToward(0, 0.4), 5);
    expect(item.fill.g).toBeCloseTo(mixToward(1, 0.4), 5);
    expect(item.fill.b).toBeCloseTo(mixToward(1, 0.4), 5);
    // In gamut: the plain proofed value (0,0,255 -> 1,1,0), with no alarm
    // mixing at all — the warning must not tint colours that are reproducible.
    expect(item.strokes[0]?.color).toMatchObject({ r: 1, g: 1, b: 0 });
  });

  it('does not request a gamut pass when the warning is disabled', () => {
    const { engine, calls } = fakeEngine({ outOfGamut: () => true });
    setProofEngineForTests(engine);

    applyProofToFrame(frameWithFourColours(), proofConfig(), { enabled: false, opacity: 0.4 });

    expect(calls).toEqual([{ n: 4, gamutCheck: false }]);
  });

  it('leaves a frame with no colours untouched', () => {
    const { engine, calls } = fakeEngine();
    setProofEngineForTests(engine);

    const items = [{ id: 'empty' }] as unknown as Parameters<typeof applyProofToFrame>[0];
    expect(applyProofToFrame(items, proofConfig())).toBe(items);
    expect(calls).toEqual([]);
  });
});
