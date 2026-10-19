/**
 * Honest install, Gatekeeper, SmartScreen, and checksum copy for the
 * download page and troubleshooting. Version-aware where 0.5.0 differs
 * from later ad-hoc-signed macOS builds.
 */
import packageManagers from './package-managers.json';

export const MACOS_QUARANTINE_ONLY_RELEASES = new Set(['0.5.0']);

/** First published AppImage that ships bundled WebKitGTK instead of host WebKit. */
export const FIRST_BUNDLED_WEBKIT_APPIMAGE = '0.5.2';

export function compareReleaseVersion(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

export function appImageShipsBundledWebKit(version: string | null | undefined): boolean {
  if (!version) return false;
  return compareReleaseVersion(version, FIRST_BUNDLED_WEBKIT_APPIMAGE) >= 0;
}

export function isMacosQuarantineOnlyRelease(version: string | null | undefined): boolean {
  return Boolean(version && MACOS_QUARANTINE_ONLY_RELEASES.has(version));
}

export function macosUnsignedCaveat(version: string | null | undefined): string {
  if (isMacosQuarantineOnlyRelease(version)) {
    return (
      '0.5.0 has no bundle-wide signature, so a browser-downloaded copy shows ' +
      '"Varve is damaged and can\'t be opened" with no Open Anyway option. ' +
      'After dragging Varve to Applications, run: xattr -dr com.apple.quarantine /Applications/Varve.app — ' +
      'that removes the download quarantine flag so macOS will open the app. Do not disable Gatekeeper.'
    );
  }
  return (
    'Not Developer ID signed or notarized. After the first launch attempt, open ' +
    'System Settings > Privacy & Security and choose Open Anyway. Do not disable Gatekeeper.'
  );
}

export function windowsUnsignedCaveat(): string {
  return (
    'Unsigned: Windows will show "Windows protected your PC". Choose More info, then Run anyway. ' +
    'Windows 11 Smart App Control can block unsigned apps with no override — use the browser version at /try if that happens.'
  );
}

export const CHECKSUM_COMMANDS = {
  linuxIgnoreMissing: 'sha256sum --ignore-missing -c SHA256SUMS.txt',
  linuxGrep: 'grep <filename> SHA256SUMS.txt | sha256sum -c',
  macosFile: 'shasum -a 256 <filename>',
  windowsFile: 'Get-FileHash .\\<filename> -Algorithm SHA256',
} as const;

export interface PackageManagerChannel {
  id: string;
  platform: 'windows' | 'macos' | 'linux';
  label: string;
  command: string;
  live: boolean;
}

export const PACKAGE_MANAGER_CHANNELS = packageManagers.channels as PackageManagerChannel[];

export function livePackageManagerChannels(
  platform?: PackageManagerChannel['platform'],
): PackageManagerChannel[] {
  return PACKAGE_MANAGER_CHANNELS.filter(
    (channel) => channel.live && (platform === undefined || channel.platform === platform),
  );
}

export const MACOS_QUARANTINE_COMMAND = 'xattr -dr com.apple.quarantine /Applications/Varve.app';

export const MACOS_QUARANTINE_EXPLAIN =
  'That command removes the browser-download quarantine flag so Gatekeeper will open the app.';
