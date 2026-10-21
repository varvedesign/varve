import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, resetSettings } from '../../settings';
import {
  isIconRemoteSearchGranted,
  readIconRemoteSearchConsent,
  writeIconRemoteSearchConsent,
} from './iconRemoteSearch';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  localStorage.clear();
});

describe('icon remote search consent', () => {
  it('defaults to not yet asked and does not grant requests', () => {
    expect(readIconRemoteSearchConsent()).toBe('unknown');
    expect(isIconRemoteSearchGranted()).toBe(false);
    expect(loadSettings().icons.remoteSearch).toBe('unknown');
  });

  it('persists Accept and Not now under icons.remoteSearch', () => {
    writeIconRemoteSearchConsent('granted');
    expect(loadSettings().icons.remoteSearch).toBe('granted');
    expect(isIconRemoteSearchGranted()).toBe(true);

    writeIconRemoteSearchConsent('denied');
    expect(loadSettings().icons.remoteSearch).toBe('denied');
    expect(isIconRemoteSearchGranted()).toBe(false);
  });
});
