/**
 * Shared release-version helpers for website copy and the release-data builder.
 * The bundled-WebKit cutoff lives in appimage-webkit.json so the two consumers
 * cannot drift.
 */
import spec from './appimage-webkit.json' with { type: 'json' };

export const FIRST_BUNDLED_WEBKIT_APPIMAGE = spec.firstBundledWebKitAppImage;

export function compareReleaseVersion(left, right) {
  const parse = (value) =>
    String(value ?? '')
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

export function appImageShipsBundledWebKit(version) {
  if (!version) return false;
  return compareReleaseVersion(version, FIRST_BUNDLED_WEBKIT_APPIMAGE) >= 0;
}
