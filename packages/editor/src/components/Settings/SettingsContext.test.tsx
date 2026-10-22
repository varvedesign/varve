// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../../settings';
import {
  SettingsProvider,
  useOptionalSettings,
  useResolvedSettings,
  useSettings,
} from './SettingsContext';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
});

function ConsentProbe() {
  const { settings } = useSettings();
  return <span data-testid="consent">{settings.icons.remoteSearch}</span>;
}

function GrantButton() {
  const { updateSettings } = useSettings();
  return (
    <button type="button" onClick={() => updateSettings({ icons: { remoteSearch: 'granted' } })}>
      Grant
    </button>
  );
}

function OptionalPeek() {
  const ctx = useOptionalSettings();
  return <span data-testid="peek">{ctx ? 'present' : 'absent'}</span>;
}

function ResolvedGrant() {
  const { settings, updateSettings } = useResolvedSettings();
  return (
    <div>
      <span data-testid="resolved-consent">{settings.icons.remoteSearch}</span>
      <button type="button" onClick={() => updateSettings({ icons: { remoteSearch: 'denied' } })}>
        Deny
      </button>
    </div>
  );
}

describe('SettingsContext', () => {
  it('syncs icon-search consent across separate SettingsProvider copies', () => {
    render(
      <>
        <SettingsProvider>
          <GrantButton />
        </SettingsProvider>
        <SettingsProvider>
          <ConsentProbe />
        </SettingsProvider>
      </>,
    );
    expect(screen.getByTestId('consent').textContent).toBe('unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    expect(loadSettings().icons.remoteSearch).toBe('granted');
    expect(screen.getByTestId('consent').textContent).toBe('granted');
  });

  it('returns null from useOptionalSettings when no provider is mounted', () => {
    render(<OptionalPeek />);
    expect(screen.getByTestId('peek').textContent).toBe('absent');
  });

  it('lets useResolvedSettings read and write consent without a provider', () => {
    render(<ResolvedGrant />);
    expect(screen.getByTestId('resolved-consent').textContent).toBe('unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(loadSettings().icons.remoteSearch).toBe('denied');
    expect(screen.getByTestId('resolved-consent').textContent).toBe('denied');
  });
});
