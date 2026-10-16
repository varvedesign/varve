// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings } from '../../settings';
import { SettingsProvider, useSettings } from './SettingsContext';

function Probe() {
  const { settings, updateSection } = useSettings();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Two changes before React can re-render, as a fast double click, a
          // key repeat or a driven UI produces. Both must survive.
          updateSection('automation', { grants: 'edit' });
          updateSection('automation', { capture: true });
        }}
      >
        two quick changes to one section
      </button>
      <button
        type="button"
        onClick={() => {
          updateSection('collab', { displayName: 'Quick' });
          updateSection('automation', { enabled: true });
        }}
      >
        two quick changes to two sections
      </button>
      <output data-testid="seen">
        {`${settings.automation.grants}|${settings.automation.capture}|${settings.automation.enabled}|${settings.collab.displayName}`}
      </output>
    </div>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('SettingsProvider.updateSection', () => {
  it('keeps both of two changes made to one section before the next render', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByText('two quick changes to one section'));
    expect(screen.getByTestId('seen').textContent).toBe(
      `edit|true|false|${loadSettings().collab.displayName}`,
    );
    const stored = loadSettings().automation;
    expect(stored.grants).toBe('edit');
    expect(stored.capture).toBe(true);
  });

  it('keeps both of two changes made to different sections before the next render', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByText('two quick changes to two sections'));
    const stored = loadSettings();
    expect(stored.collab.displayName).toBe('Quick');
    expect(stored.automation.enabled).toBe(true);
    expect(screen.getByTestId('seen').textContent?.endsWith('|Quick')).toBe(true);
  });

  it('still applies a change after a render has happened', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    fireEvent.click(screen.getByText('two quick changes to one section'));
    act(() => {
      fireEvent.click(screen.getByText('two quick changes to two sections'));
    });
    const stored = loadSettings();
    expect(stored.automation).toMatchObject({ grants: 'edit', capture: true, enabled: true });
    expect(stored.collab.displayName).toBe('Quick');
  });
});
