import { type IconRemoteSearchConsent, loadSettings, updateSettings } from '../../settings';

export const ICON_REMOTE_SEARCH_CHANGED_EVENT = 'varve:icons-remote-search';

export function readIconRemoteSearchConsent(): IconRemoteSearchConsent {
  try {
    return loadSettings().icons.remoteSearch;
  } catch {
    return 'unknown';
  }
}

export function dispatchIconRemoteSearchChanged(value: IconRemoteSearchConsent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ICON_REMOTE_SEARCH_CHANGED_EVENT, { detail: value }));
}

export function writeIconRemoteSearchConsent(
  value: Exclude<IconRemoteSearchConsent, 'unknown'>,
): IconRemoteSearchConsent {
  updateSettings({ icons: { remoteSearch: value } });
  dispatchIconRemoteSearchChanged(value);
  return value;
}

export function isIconRemoteSearchGranted(
  value: IconRemoteSearchConsent = readIconRemoteSearchConsent(),
): boolean {
  return value === 'granted';
}
