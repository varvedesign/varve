import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../pages/about/privacy.astro', import.meta.url), 'utf8');
const about = fs.readFileSync(new URL('../pages/about.astro', import.meta.url), 'utf8');
const disclosure = fs.readFileSync(
  new URL('../pages/docs/privacy/analytics.astro', import.meta.url),
  'utf8',
);

describe('privacy page product-usage claims', () => {
  it('says the desktop app sends no usage stats and GoatCounter is consent-gated', () => {
    expect(page).toMatch(/The desktop app sends no usage stats/);
    expect(page).toMatch(/website and the browser demo use GoatCounter/);
    expect(page).toMatch(/only after you click Allow/);
    expect(page).toMatch(/Nothing about your design is sent/);
    expect(page).not.toMatch(/Plausible/);
    expect(page).not.toMatch(/plausible\.io/);
    expect(page).not.toMatch(/usage isn't measured/i);
    expect(page).not.toMatch(/we don't measure usage/i);
    expect(page).not.toMatch(/product usage are not measured/i);
  });

  it('keeps the same claims on About and the analytics disclosure', () => {
    expect(about).toMatch(/The desktop app sends no usage\s+stats/);
    expect(about).toMatch(/GoatCounter only after you click Allow/);
    expect(about).not.toMatch(/Plausible/);
    expect(disclosure).toMatch(/The desktop app sends no usage stats/);
    expect(disclosure).toMatch(/demo-launch-direct/);
    expect(disclosure).toMatch(/demo-export-png/);
    expect(disclosure).not.toMatch(/Plausible/);
  });
});
