import { describe, expect, it } from 'vitest';
import { pathWithCampaign, websiteCampaignRef } from './campaign';

describe('website campaign ref allowlist', () => {
  it('accepts hyphenated suffixes and the acquisition prefixes', () => {
    expect(websiteCampaignRef('?ref=hn-post')).toBe('hn-post');
    expect(websiteCampaignRef('?ref=reddit-graphic-design')).toBe('reddit-graphic-design');
    expect(websiteCampaignRef('?ref=li-s8')).toBe('li-s8');
    expect(websiteCampaignRef('?ref=home-hero')).toBe('home-hero');
    expect(pathWithCampaign('try', '?ref=hn-post')).toBe('try?ref=hn-post');
  });

  it('drops unknown tags', () => {
    expect(websiteCampaignRef('?ref=evil')).toBeNull();
    expect(pathWithCampaign('try', '?ref=evil')).toBe('try');
  });
});
