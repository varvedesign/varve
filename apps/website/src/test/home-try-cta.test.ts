import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const hero = fs.readFileSync(new URL('../components/Hero.astro', import.meta.url), 'utf8');
const closing = fs.readFileSync(new URL('../components/ClosingCTA.astro', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../pages/index.astro', import.meta.url), 'utf8');

describe('home try-in-browser CTAs', () => {
  it('points the hero secondary button at /try with home-hero and keeps the product text link', () => {
    expect(hero).toMatch(/Try it in your browser/);
    expect(hero).toMatch(/\/try\/\?ref=home-hero/);
    expect(hero).toMatch(/data-analytics-demo-launch/);
    expect(hero).toMatch(/What is Varve\?/);
    expect(hero).toMatch(/sitePath\('\/product'\)/);
  });

  it('adds the same button to ClosingCTA and renders that section on home', () => {
    expect(closing).toMatch(/Try it in your browser/);
    expect(closing).toMatch(/\/try\/\?ref=home-closing/);
    expect(closing).toMatch(/data-analytics-demo-launch/);
    expect(closing).toMatch(/showTryBrowser/);
    expect(index).toMatch(/<ClosingCTA/);
  });
});
