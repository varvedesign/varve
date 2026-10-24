import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, resetSettings, updateSettings } from '../../settings';
import { SettingsProvider, useSettings } from './SettingsContext';

function Surface({ name }: { name: string }) {
  const settings = useSettings();
  return (
    <>
      <output aria-label={`${name} diagnostics`}>
        {String(settings.settings.performance.showPerformanceDiagnostics)}
      </output>
      <button
        type="button"
        onClick={() =>
          settings.updateSettings({ performance: { showPerformanceDiagnostics: true } })
        }
      >
        Enable {name} diagnostics
      </button>
      <button
        type="button"
        onClick={() => settings.updateSection('performance', { reducedMotionOverride: 'always' })}
      >
        Reduce {name} motion
      </button>
      <button type="button" onClick={settings.resetSettings}>
        Reset {name} settings
      </button>
    </>
  );
}

function renderSurfaces() {
  return render(
    <>
      <SettingsProvider>
        <Surface name="Home" />
      </SettingsProvider>
      <SettingsProvider>
        <Surface name="Editor" />
      </SettingsProvider>
    </>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('settings continuity across mounted surfaces', () => {
  it('shares changes and resets without losing another surface’s section values', () => {
    renderSurfaces();
    fireEvent.click(screen.getByRole('button', { name: 'Enable Editor diagnostics' }));
    expect(screen.getByLabelText('Home diagnostics')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: 'Reduce Home motion' }));
    expect(loadSettings().performance).toMatchObject({
      reducedMotionOverride: 'always',
      showPerformanceDiagnostics: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Home settings' }));
    expect(screen.getByLabelText('Editor diagnostics')).toHaveTextContent('false');
  });

  it('observes canonical store commands outside either provider', () => {
    renderSurfaces();
    act(() => updateSettings({ performance: { showPerformanceDiagnostics: true } }));
    expect(screen.getByLabelText('Home diagnostics')).toHaveTextContent('true');
    expect(screen.getByLabelText('Editor diagnostics')).toHaveTextContent('true');
    act(() => resetSettings());
    expect(screen.getByLabelText('Home diagnostics')).toHaveTextContent('false');
    expect(screen.getByLabelText('Editor diagnostics')).toHaveTextContent('false');
  });
});
