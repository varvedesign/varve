import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../pages/about/privacy.astro', import.meta.url), 'utf8');

describe('privacy page product-usage claims', () => {
  it('names Plausible and Settings consent for desktop usage events', () => {
    expect(page).toMatch(
      /The desktop app can send anonymous usage events to Plausible only if you turn it on in\s+Settings/,
    );
    expect(page).toMatch(/Nothing is sent unless you say yes/);
    expect(page).toMatch(/<strong>Plausible<\/strong> for consented desktop usage events/);
    expect(page).not.toMatch(/usage isn't measured/i);
    expect(page).not.toMatch(/we don't measure usage/i);
    expect(page).not.toMatch(/product usage are not measured/i);
  });
});
