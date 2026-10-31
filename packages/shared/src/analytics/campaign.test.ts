import { describe, expect, it } from 'vitest';
import { campaignCountQuery, pathWithCampaign, websiteCampaignRef } from './campaign';

describe('website campaign ref allowlist', () => {
  it('accepts hyphenated suffixes and the acquisition prefixes', () => {
    expect(websiteCampaignRef('?ref=hn-post')).toBe('hn-post');
    expect(websiteCampaignRef('?ref=reddit-graphic-design')).toBe('reddit-graphic-design');
    expect(websiteCampaignRef('?ref=li-s8')).toBe('li-s8');
    expect(websiteCampaignRef('?ref=home-hero')).toBe('home-hero');
    expect(pathWithCampaign('try', '?ref=hn-post')).toBe('try?ref=hn-post');
    expect(campaignCountQuery('?ref=hn-test')).toBe('?ref=hn-test');
  });

  it('drops unknown tags and never forwards other query keys', () => {
    expect(websiteCampaignRef('?ref=evil')).toBeNull();
    expect(pathWithCampaign('try', '?ref=evil')).toBe('try');
    expect(campaignCountQuery('?ref=evil')).toBeNull();
    expect(campaignCountQuery('?utm_source=other&next=/admin')).toBeNull();
    expect(campaignCountQuery('?ref=hn-test&utm_campaign=other&token=secret')).toBe('?ref=hn-test');
  });
});
