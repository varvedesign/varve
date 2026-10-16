import { describe, expect, it } from 'vitest';
import { applySplice, clusters, mergeIncomingSplice, spliceBetween } from './textSplice';

describe('spliceBetween', () => {
  it('returns null for identical texts', () => {
    expect(spliceBetween('same', 'same')).toBeNull();
  });

  it('trims equal prefix and suffix', () => {
    expect(spliceBetween('hello world', 'hello brave world')).toEqual({
      start: 6,
      end: 6,
      replacement: ['b', 'r', 'a', 'v', 'e', ' '],
    });
  });

  it('treats emoji sequences as single clusters', () => {
    // Thumbs-up + skin-tone modifier is one grapheme cluster.
    expect(clusters('\u{1f44d}\u{1f3fd}x').length).toBe(2);
    const splice = spliceBetween('a\u{1f44d}\u{1f3fd}b', 'a\u{1f44d}\u{1f3fd}B');
    expect(splice).toEqual({ start: 2, end: 3, replacement: ['B'] });
  });
});

describe('mergeIncomingSplice convergence', () => {
  // Room semantics: op A has sequence 1, op B sequence 2. When B's op is
  // applied on A's state, B is later. When A's op is applied on B's state,
  // A is earlier. Both orders must converge to the same text.
  function converge(
    base: string,
    a: (t: string) => string,
    b: (t: string) => string,
  ): {
    fromA: string;
    fromB: string;
  } {
    const aSplice = spliceBetween(base, a(base));
    const bSplice = spliceBetween(base, b(base));
    expect(aSplice).not.toBeNull();
    expect(bSplice).not.toBeNull();

    // B's op applied at A's site: B is the later sequence.
    const fromA = mergeIncomingSplice(base, a(base), bSplice!, { incomingIsLater: true });
    // A's op applied at B's site: A is the earlier sequence.
    const fromB = mergeIncomingSplice(base, b(base), aSplice!, { incomingIsLater: false });
    return { fromA: fromA.text, fromB: fromB.text };
  }

  it('disjoint inserts: both survive', () => {
    const { fromA, fromB } = converge(
      'hello world',
      (t) => t.replace('hello', 'HEY'),
      (t) => t.replace('world', 'earth'),
    );
    expect(fromA).toBe(fromB);
    expect(fromA).toContain('HEY');
    expect(fromA).toContain('earth');
  });

  it('same-point inserts: earlier sequence lands first on both sites', () => {
    const { fromA, fromB } = converge(
      'abc',
      (t) => applySplice(t, { start: 1, end: 1, replacement: clusters('X') }),
      (t) => applySplice(t, { start: 1, end: 1, replacement: clusters('Y') }),
    );
    expect(fromA).toBe(fromB);
    expect(fromA).toBe('aXYbc');
  });

  it('overlapping replaces: later sequence wins on both sites', () => {
    const { fromA, fromB } = converge(
      'hello world',
      (t) => t.replace('hello', 'HEY'),
      (t) => t.replace('hello', 'yo'),
    );
    expect(fromA).toBe(fromB);
    expect(fromA).toBe('yo world');
  });

  it('insert inside a remote delete span converges', () => {
    const { fromA, fromB } = converge(
      'abcdef',
      (t) => applySplice(t, { start: 1, end: 4, replacement: [] }),
      (t) => applySplice(t, { start: 2, end: 2, replacement: clusters('Z') }),
    );
    expect(fromA).toBe(fromB);
    expect(fromA).toBe('aZef');
  });

  it('disjoint deletes converge', () => {
    const { fromA, fromB } = converge(
      'abcdef',
      (t) => applySplice(t, { start: 0, end: 2, replacement: [] }),
      (t) => applySplice(t, { start: 4, end: 6, replacement: [] }),
    );
    expect(fromA).toBe(fromB);
    expect(fromA).toBe('cd');
  });

  it('randomized schedules always converge', () => {
    // Deterministic PRNG (xorshift) so failures are reproducible.
    let seed = 0x9e3779b9;
    const next = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 0xffffffff;
    };
    const alphabet = ['a', 'b', 'c', 'd', 'e', '\u{1f44d}\u{1f3fd}', '\u{0627}', '\u{0628}'];
    const randomText = (maxLen: number) => {
      const length = Math.floor(next() * maxLen);
      let out = '';
      for (let i = 0; i < length; i++) out += alphabet[Math.floor(next() * alphabet.length)];
      return out;
    };
    const randomEdit = (text: string) => {
      const parts = clusters(text);
      const start = Math.floor(next() * (parts.length + 1));
      const end = Math.min(parts.length, start + Math.floor(next() * 3));
      const replacement = randomText(3);
      return applySplice(text, { start, end, replacement: clusters(replacement) });
    };

    for (let i = 0; i < 500; i++) {
      const base = randomText(6);
      const aAfter = randomEdit(base);
      const bAfter = randomEdit(base);
      const aSplice = spliceBetween(base, aAfter);
      const bSplice = spliceBetween(base, bAfter);
      if (!aSplice || !bSplice) continue;
      const fromA = mergeIncomingSplice(base, aAfter, bSplice, { incomingIsLater: true });
      const fromB = mergeIncomingSplice(base, bAfter, aSplice, { incomingIsLater: false });
      expect({ case: i, text: fromA.text }).toEqual({ case: i, text: fromB.text });
    }
  });
});
