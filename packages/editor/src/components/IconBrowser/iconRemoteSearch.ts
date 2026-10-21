import { type IconRemoteSearchConsent, loadSettings, updateSettings } from '../../settings';

export const ICON_REMOTE_SEARCH_CHANGED_EVENT = 'varve:icons-remote-search';

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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ICON_REMOTE_SEARCH_CHANGED_EVENT, { detail: value }));
  }
  return value;
}

export function isIconRemoteSearchGranted(
  value: IconRemoteSearchConsent = readIconRemoteSearchConsent(),
): boolean {
  return value === 'granted';
}
