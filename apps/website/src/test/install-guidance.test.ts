import { describe, expect, it } from 'vitest';
import { FIRST_BUNDLED_WEBKIT_APPIMAGE as releaseFirstBundled } from '../../../../scripts/release/website-release-data.mjs';
import spec from '../data/appimage-webkit.json';
import {
  appImageShipsBundledWebKit,
  CHECKSUM_COMMANDS,
  livePackageManagerChannels,
  macosUnsignedCaveat,
  PACKAGE_MANAGER_CHANNELS,
  FIRST_BUNDLED_WEBKIT_APPIMAGE as siteFirstBundled,
  windowsUnsignedCaveat,
} from '../data/install-guidance';

describe('install guidance', () => {
  it('tells 0.5.0 users to clear quarantine and later releases to use Open Anyway', () => {
    const legacy = macosUnsignedCaveat('0.5.0');
    expect(legacy).toContain('xattr -dr com.apple.quarantine /Applications/Varve.app');
    expect(legacy).toMatch(/no Open Anyway option/);
    expect(macosUnsignedCaveat('0.5.1')).toMatch(/Open Anyway/);
    expect(macosUnsignedCaveat('0.5.1')).not.toContain('xattr');
  });

  it('keeps SmartScreen override copy and names Smart App Control', () => {
    const windows = windowsUnsignedCaveat();
    expect(windows).toMatch(/More info, then Run anyway/);
    expect(windows).toMatch(/Smart App Control/);
    expect(windows).toContain('/try');
  });

  it('does not describe 0.5.x AppImages as shipping WebKitGTK', () => {
    expect(siteFirstBundled).toBe(spec.firstBundledWebKitAppImage);
    expect(releaseFirstBundled).toBe(spec.firstBundledWebKitAppImage);
    expect(appImageShipsBundledWebKit('0.5.0')).toBe(false);
    expect(appImageShipsBundledWebKit('0.5.1')).toBe(false);
    expect(appImageShipsBundledWebKit(null)).toBe(false);
    expect(appImageShipsBundledWebKit('0.5.2')).toBe(true);
    expect(appImageShipsBundledWebKit('0.6.0')).toBe(true);
  });

  it('gives single-file checksum commands instead of a full SHA256SUMS check', () => {
    expect(CHECKSUM_COMMANDS.linuxIgnoreMissing).toBe(
      'sha256sum --ignore-missing -c SHA256SUMS.txt',
    );
    expect(CHECKSUM_COMMANDS.linuxGrep).toContain('grep <filename>');
    expect(CHECKSUM_COMMANDS.macosFile).toBe('shasum -a 256 <filename>');
    expect(CHECKSUM_COMMANDS.windowsFile).toContain('Get-FileHash');
    expect(CHECKSUM_COMMANDS.linuxIgnoreMissing).not.toBe('sha256sum -c SHA256SUMS.txt');
  });

  it('keeps package-manager channels hidden until they are live', () => {
    expect(PACKAGE_MANAGER_CHANNELS.length).toBe(3);
    expect(PACKAGE_MANAGER_CHANNELS.map((channel) => channel.id).sort()).toEqual([
      'homebrew',
      'scoop',
      'winget',
    ]);
    expect(PACKAGE_MANAGER_CHANNELS.every((channel) => channel.live === false)).toBe(true);
    expect(livePackageManagerChannels()).toEqual([]);
    expect(PACKAGE_MANAGER_CHANNELS.find((channel) => channel.id === 'winget')?.command).toBe(
      'winget install varvedesign.Varve',
    );
    expect(PACKAGE_MANAGER_CHANNELS.find((channel) => channel.id === 'homebrew')?.command).toBe(
      'brew install --cask varvedesign/varve/varve',
    );
  });
});
