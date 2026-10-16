import { describe, expect, it } from 'vitest';
import { fallbackColorIndex, mintClientId } from './identity';

describe('identity', () => {
  it('mints unique client ids via the platform CSPRNG', () => {
    const a = mintClientId();
    const b = mintClientId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('maps actor ids onto the 8-slot palette deterministically', () => {
    expect(fallbackColorIndex('actor-1')).toBe(fallbackColorIndex('actor-1'));
    expect(fallbackColorIndex('actor-2')).toBe(fallbackColorIndex('actor-2'));
    for (let i = 0; i < 50; i++) {
      const index = fallbackColorIndex(`actor-${i}`);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(7);
    }
  });

  it('spreads distinct actor ids across palette slots', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(String(fallbackColorIndex(`participant-${i}`)));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
