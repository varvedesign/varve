import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const securityTxtPath = join(websiteRoot, 'public/.well-known/security.txt');

describe('security.txt', () => {
  it('is a static public file that the website build copies', () => {
    const body = readFileSync(securityTxtPath, 'utf8');
    expect(body).toContain('Contact: mailto:security@varve.studio');
    expect(body).toContain('Policy: https://github.com/varvedesign/varve/blob/master/SECURITY.md');
    expect(body).toContain('Preferred-Languages: en');
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
    const expires = body.match(/^Expires: (.+)$/m)?.[1];
    expect(expires).toBeTruthy();
    expect(new Date(expires as string).getTime()).toBeGreaterThan(Date.now());
  });
});
