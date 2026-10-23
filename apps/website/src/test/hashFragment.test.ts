import { describe, expect, it } from 'vitest';
import { decodeHashId } from '../lib/hashFragment';

describe('decodeHashId', () => {
  it('strips the leading hash and decodes percent escapes', () => {
    expect(decodeHashId('#platform-macos')).toBe('platform-macos');
    expect(decodeHashId('#caf%C3%A9')).toBe('café');
  });

  it('accepts a bare fragment and empty input', () => {
    expect(decodeHashId('macos')).toBe('macos');
    expect(decodeHashId('')).toBe('');
    expect(decodeHashId(null)).toBe('');
    expect(decodeHashId(undefined)).toBe('');
  });

  it('returns empty rather than throwing on a malformed escape', () => {
    // A bad fragment must not break page bootstrap: tab activation, the
    // recommendation banner and the hashchange listener all run after this.
    expect(() => decodeHashId('#100%')).not.toThrow();
    expect(decodeHashId('#100%')).toBe('');
    expect(decodeHashId('#a%zz')).toBe('');
    expect(decodeHashId('#%')).toBe('');
  });
});
