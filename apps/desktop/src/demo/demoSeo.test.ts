import { describe, expect, it } from 'vitest';
import {
  DEMO_CANONICAL_URL,
  DEMO_DESCRIPTION,
  DEMO_SOCIAL_IMAGE_URL,
  DEMO_TITLE,
  injectDemoSeo,
} from './demoSeo';

const SHELL =
  '<!doctype html><html><head><title>Varve</title></head><body>' +
  '<div id="varve-boot-fallback"><!-- varve-demo-shell --></div>' +
  '<div id="root"></div></body></html>';

describe('public browser demo metadata', () => {
  it('adds canonical, description, social cards, and WebPage data', () => {
    const html = injectDemoSeo(SHELL);

    expect(html).toContain(`<title>${DEMO_TITLE}</title>`);
    expect(html).toContain(`<meta name="description" content="${DEMO_DESCRIPTION}" />`);
    expect(html).toContain(`<link rel="canonical" href="${DEMO_CANONICAL_URL}" />`);
    expect(html).toContain(`<meta property="og:image" content="${DEMO_SOCIAL_IMAGE_URL}" />`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebPage"');
    expect(html).toContain(DEMO_DESCRIPTION);
    expect(DEMO_DESCRIPTION).toMatch(/vector, layout, comic lettering, drawing, photo and print/);
    expect(DEMO_DESCRIPTION).not.toMatch(/prototyping/);
    expect(DEMO_DESCRIPTION).not.toMatch(/motion, and print/);
    expect(html).toContain('"operatingSystem":"Linux, Windows, Apple Silicon Mac"');
  });

  it('injects one static H1, the limits link, and a Download CTA for no-JS readers', () => {
    const html = injectDemoSeo(SHELL);

    expect(html).toContain('<h1 class="boot-title">Try Varve in your browser</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('bounded browser build');
    expect(html).toContain('href="/docs/browser-demo/"');
    expect(html).toContain('href="/download/"');
    expect(html).not.toContain('<!-- varve-demo-shell -->');

    const fallback =
      html.split('<div id="varve-boot-fallback">')[1]?.split('<div id="root">')[0] ?? '';
    const text = fallback
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text.split(' ').length).toBeGreaterThanOrEqual(40);
  });

  it('is idempotent when the HTML transform is called twice', () => {
    const once = injectDemoSeo(SHELL);
    expect(injectDemoSeo(once)).toBe(once);
  });
});
