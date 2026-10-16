/**
 * Tests that the ICC proof provider reports the truth about what it can do.
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
 */

import type { ProofConfig } from '@varve/scene';
import { isProofingAvailable } from '@varve/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProofToFrame,
  ensureProofProvider,
  proofProviderStatus,
  resetProofProviderForTests,
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

describe('applyProofToFrame', () => {
  it('is a no-op while proofing is unavailable, and never invents proofed colours', () => {
    const items = [{ id: 'a' }, { id: 'b' }] as unknown as Parameters<typeof applyProofToFrame>[0];

    // Disabled: identical array identity, so callers can skip downstream work.
    expect(applyProofToFrame(items, null)).toBe(items);
    // Enabled but unavailable: still identical, rather than a silent
    // second-best conversion.
    expect(applyProofToFrame(items, proofConfig())).toBe(items);
  });
});
