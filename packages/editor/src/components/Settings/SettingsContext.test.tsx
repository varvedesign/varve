// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../../settings';
import { SettingsProvider, useOptionalSettings, useSettings } from './SettingsContext';

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

function OptionalGrant() {
  const { settings, updateSettings } = useOptionalSettings();
  return (
    <div>
      <span data-testid="optional-consent">{settings.icons.remoteSearch}</span>
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

  it('lets useOptionalSettings read and write consent without a provider', () => {
    render(<OptionalGrant />);
    expect(screen.getByTestId('optional-consent').textContent).toBe('unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(loadSettings().icons.remoteSearch).toBe('denied');
    expect(screen.getByTestId('optional-consent').textContent).toBe('denied');
  });
});
