import { type IconRemoteSearchConsent, loadSettings, updateSettings } from '../../settings';

export function readIconRemoteSearchConsent(): IconRemoteSearchConsent {
  try {
    return loadSettings().icons.remoteSearch;
  } catch {
    return 'unknown';
  }
}

export function writeIconRemoteSearchConsent(
  value: Exclude<IconRemoteSearchConsent, 'unknown'>,
): IconRemoteSearchConsent {
  updateSettings({ icons: { remoteSearch: value } });
  return value;
}

export function isIconRemoteSearchGranted(
  value: IconRemoteSearchConsent = readIconRemoteSearchConsent(),
): boolean {
  return value === 'granted';
}
