import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../pages/download.astro', import.meta.url), 'utf8');

describe('download page install routes', () => {
  it('documents the tracked Arch PKGBUILD without claiming an AUR package is published', () => {
    const pkgbuild = fs.readFileSync(
      new URL('../../../../packaging/aur/varve-desktop-bin/PKGBUILD', import.meta.url),
      'utf8',
    );
    expect(pkgbuild).toContain('pkgname=varve-desktop-bin');
    expect(page).toMatch(/PKGBUILD <span class="format-badge">recommended<\/span>/);
    expect(page).toMatch(/makepkg -si/);
    expect(page).toMatch(/packaging\/aur\/varve-desktop-bin/);
    expect(page).toMatch(/An AUR package is coming/);
    expect(page).toMatch(/AUR registration is currently closed/);
    expect(page).not.toMatch(/AUR package is available/);
  });

  it('formats the stored calendar date without a local timezone shift', () => {
    expect(page).toMatch(/formatReleaseDate\(release\.releaseDate\)/);
    expect(page).toMatch(/timeZone: 'UTC'/);
  });
});
