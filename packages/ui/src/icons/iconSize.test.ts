import { describe, expect, it } from 'vitest';
import { isIconSizeName, resolveIconSize } from './iconSize';

describe('resolveIconSize', () => {
  it('defaults to the sm step', () => {
    expect(resolveIconSize(undefined)).toBe(16);
  });

  it('maps a token name to its pixel size, including xs', () => {
    expect(resolveIconSize('xs')).toBe(12);
    expect(resolveIconSize('sm')).toBe(16);
    expect(resolveIconSize('md')).toBe(20);
    expect(resolveIconSize('lg')).toBe(24);
    expect(resolveIconSize('xl')).toBe(32);
  });

  it('snaps raw pixel sizes to the nearest step', () => {
    expect(resolveIconSize(10)).toBe(12);
    expect(resolveIconSize(11)).toBe(12);
    expect(resolveIconSize(12)).toBe(16);
    expect(resolveIconSize(14)).toBe(16);
    expect(resolveIconSize(16)).toBe(16);
    expect(resolveIconSize(18)).toBe(20);
    expect(resolveIconSize(24)).toBe(24);
    expect(resolveIconSize(32)).toBe(32);
  });

  it('snaps em and rem sizes so a glyph is the same size in every font size', () => {
    expect(resolveIconSize('0.65em')).toBe(12);
    expect(resolveIconSize('0.7em')).toBe(12);
    expect(resolveIconSize('0.75em')).toBe(16);
    expect(resolveIconSize('0.85em')).toBe(16);
    expect(resolveIconSize('1em')).toBe(16);
    expect(resolveIconSize('1.2em')).toBe(20);
    expect(resolveIconSize('1.5em')).toBe(24);
    expect(resolveIconSize('0.875rem')).toBe(16);
    expect(resolveIconSize('16px')).toBe(16);
  });

  it('passes through sizes above the scale and values it cannot parse', () => {
    expect(resolveIconSize(48)).toBe(48);
    expect(resolveIconSize('4em')).toBe('4em');
    expect(resolveIconSize('100%')).toBe('100%');
  });

  it('recognises only the five token names', () => {
    expect(isIconSizeName('md')).toBe(true);
    expect(isIconSizeName('huge')).toBe(false);
    expect(isIconSizeName(16)).toBe(false);
  });
});
