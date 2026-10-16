import { describe, expect, it } from 'vitest';
import { verticalOrientationForCluster, verticalShapingDirection } from './verticalText';

describe('vertical text semantics', () => {
  it('uses cluster-level Unicode properties for mixed orientation', () => {
    expect(verticalOrientationForCluster('A')).toBe('sideways');
    expect(verticalOrientationForCluster('あ')).toBe('upright');
    expect(verticalOrientationForCluster('\u{1f642}')).toBe('upright');
    expect(verticalOrientationForCluster('e\u0301')).toBe('sideways');
    expect(verticalOrientationForCluster('e\u0301', 'upright')).toBe('upright');
  });

  it('resolves mixed orientation from the pinned UAX #50 table', () => {
    // Han / kana / hangul are U.
    expect(verticalOrientationForCluster('字')).toBe('upright');
    expect(verticalOrientationForCluster('カ')).toBe('upright');
    expect(verticalOrientationForCluster('한')).toBe('upright');
    // CJK punctuation is U; ASCII and typographic punctuation are R.
    expect(verticalOrientationForCluster('\u{3001}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{3002}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{300c}')).toBe('upright');
    expect(verticalOrientationForCluster('!')).toBe('sideways');
    expect(verticalOrientationForCluster('(')).toBe('sideways');
    expect(verticalOrientationForCluster(',')).toBe('sideways');
    expect(verticalOrientationForCluster('-')).toBe('sideways');
    expect(verticalOrientationForCluster('.')).toBe('sideways');
    expect(verticalOrientationForCluster('\u{2018}')).toBe('sideways');
    expect(verticalOrientationForCluster('\u{2014}')).toBe('sideways');
    // Digits: ASCII digits rotate, fullwidth digits stay upright.
    expect(verticalOrientationForCluster('5')).toBe('sideways');
    expect(verticalOrientationForCluster('\u{ff15}')).toBe('upright');
    // Fullwidth exclamation is Tu (upright fallback); halfwidth katakana is
    // R in UAX #50 (a horizontal-text form, rotated in vertical flow).
    expect(verticalOrientationForCluster('\u{ff01}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{ff75}')).toBe('sideways');
    // Katakana-Hiragana double hyphen is Tr (rotated fallback).
    expect(verticalOrientationForCluster('\u{30a0}')).toBe('sideways');
    // Circled/enclosed symbols and currency stay upright; ASCII dollar rotates.
    expect(verticalOrientationForCluster('\u{00a9}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{2460}')).toBe('upright');
    expect(verticalOrientationForCluster('$')).toBe('sideways');
    // Unlisted code points default to R, but unassigned CJK-adjacent and
    // private-use ranges default to U per the file header.
    expect(verticalOrientationForCluster('\u{1d400}')).toBe('sideways');
    expect(verticalOrientationForCluster('\u{e000}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{3400}')).toBe('upright');
  });

  it('keeps pictographic emoji upright where the table defaults to R', () => {
    // U+2764 and U+231A are absent from VerticalOrientation.txt (default R),
    // but browsers present them upright through the color emoji font.
    expect(verticalOrientationForCluster('\u{2764}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{231a}')).toBe('upright');
    // Emoji presentation selector forces upright (keycap, heart+VS16).
    expect(verticalOrientationForCluster('1\u{fe0f}\u{20e3}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{2764}\u{fe0f}')).toBe('upright');
    // ZWJ family sequence resolves upright from its first pictographic base.
    expect(verticalOrientationForCluster('\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}')).toBe(
      'upright',
    );
    // Flag: regional indicators are U in the table.
    expect(verticalOrientationForCluster('\u{1f1ef}\u{1f1f5}')).toBe('upright');
  });

  it('applies variation selectors to transformed-orientation bases', () => {
    // U+30A0 is Tr: rotated by default, vertical form (VS1) upright.
    expect(verticalOrientationForCluster('\u{30a0}\u{fe00}')).toBe('upright');
    expect(verticalOrientationForCluster('\u{30a0}\u{fe01}')).toBe('sideways');
    // U+FF08 is Tr likewise.
    expect(verticalOrientationForCluster('(\u{fe00}')).toBe('sideways');
    expect(verticalOrientationForCluster('\u{ff08}\u{fe00}')).toBe('upright');
  });

  it('honors explicit upright and sideways overrides before the table', () => {
    expect(verticalOrientationForCluster('あ', 'sideways')).toBe('sideways');
    expect(verticalOrientationForCluster('A', 'upright')).toBe('upright');
    expect(verticalOrientationForCluster('', 'mixed')).toBe('upright');
    expect(verticalOrientationForCluster('\u{0301}')).toBe('upright');
  });

  it('maps both CSS vertical writing modes to top-to-bottom shaping', () => {
    expect(verticalShapingDirection('vertical-rl')).toBe('ttb');
    expect(verticalShapingDirection('vertical-lr')).toBe('ttb');
    expect(verticalShapingDirection('horizontal-tb')).toBe('ltr');
  });
});
