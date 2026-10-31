import { invoke } from '@tauri-apps/api/core';
import {
  assertAiFeaturesEnabled,
  configureAiPolicyOverride,
  getAiFeaturesEnabled,
  notifyAiFeaturesSettingsChanged,
} from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOrganizationAiPolicy,
  beginOrganizationPolicyLoad,
  isOrganizationLocked,
  loadOrganizationPolicy,
  type OrganizationPolicyStatus,
  resetOrganizationPolicyLoadForTests,
  resolveOrganizationAiMode,
} from './organizationPolicy';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe('organization settings locks', () => {
  it('locks only keys listed by the administrator', () => {
    const policy: OrganizationPolicyStatus = {
      restricted: false,
      lockedSettings: ['updates.check'],
    };
    expect(isOrganizationLocked(policy, 'updates.check')).toBe(true);
    expect(isOrganizationLocked(policy, 'ai.enabled')).toBe(false);
  });
});

describe('resolveOrganizationAiMode', () => {
  it('fails closed when the policy file exists but cannot be read', () => {
    expect(resolveOrganizationAiMode({ restricted: true, error: 'invalid json' })).toBe('off');
    expect(resolveOrganizationAiMode({ restricted: true })).toBe('off');
    expect(resolveOrganizationAiMode({ restricted: false, error: 'parse failed' })).toBe('off');
  });

  it('honours on, off, and user when the file is readable', () => {
    expect(resolveOrganizationAiMode({ restricted: false, aiEnabled: 'on' })).toBe('on');
    expect(resolveOrganizationAiMode({ restricted: false, aiEnabled: 'off' })).toBe('off');
    expect(resolveOrganizationAiMode({ restricted: false, aiEnabled: 'user' })).toBe('user');
    expect(resolveOrganizationAiMode({ restricted: false })).toBe('user');
  });
});

describe('organization AI policy overlay', () => {
  afterEach(() => {
    localStorage.clear();
    resetOrganizationPolicyLoadForTests();
    configureAiPolicyOverride('user');
    notifyAiFeaturesSettingsChanged();
    vi.unstubAllGlobals();
    mockedInvoke.mockReset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('forces the engine gate off even when the user setting is still on', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    applyOrganizationAiPolicy({ aiEnabled: 'off' });
    expect(getAiFeaturesEnabled()).toBe(false);
  });

  it('forces the engine gate on even when the user setting is off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    applyOrganizationAiPolicy({ aiEnabled: 'on' });
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('returns control to the user setting when policy is user', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    applyOrganizationAiPolicy({ aiEnabled: 'off' });
    applyOrganizationAiPolicy({ aiEnabled: 'user' });
    expect(getAiFeaturesEnabled()).toBe(false);
  });

  it('treats an unreadable policy file as AI off', () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    applyOrganizationAiPolicy({ restricted: true, error: 'Invalid policy /etc/varve/policy.json' });
    expect(getAiFeaturesEnabled()).toBe(false);
  });
});

describe('beginOrganizationPolicyLoad', () => {
  afterEach(() => {
    localStorage.clear();
    resetOrganizationPolicyLoadForTests();
    notifyAiFeaturesSettingsChanged();
    mockedInvoke.mockReset();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('leaves the user setting in place when there is no Tauri policy host', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    const policy = await loadOrganizationPolicy();
    expect(policy.present).toBe(false);
    expect(policy.restricted).toBe(false);
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('holds AI off on Tauri until policy_status returns', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    let release!: (value: OrganizationPolicyStatus) => void;
    mockedInvoke.mockReturnValue(
      new Promise<OrganizationPolicyStatus>((resolve) => {
        release = resolve;
      }),
    );

    const pending = beginOrganizationPolicyLoad();
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(() => assertAiFeaturesEnabled()).toThrow(/ai_disabled|AI features/i);

    release({ present: false, restricted: false, lockedSettings: [] });
    await pending;
    expect(getAiFeaturesEnabled()).toBe(true);
  });

  it('gates AI without a SettingsProvider so auxiliary webviews still receive policy', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockResolvedValue({
      present: true,
      restricted: true,
      error: 'Invalid policy /etc/varve/policy.json: policy must be a JSON object',
      lockedSettings: [],
    });

    const policy = await beginOrganizationPolicyLoad();
    expect(policy.error).toMatch(/invalid policy/i);
    expect(getAiFeaturesEnabled()).toBe(false);
    expect(() => assertAiFeaturesEnabled()).toThrow();
  });

  it('fails closed when policy_status throws', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockRejectedValue(new Error('ipc unavailable'));

    const policy = await beginOrganizationPolicyLoad();
    expect(policy.restricted).toBe(true);
    expect(policy.error).toMatch(/organisation policy/i);
    expect(getAiFeaturesEnabled()).toBe(false);
  });

  it('fails closed when policy_status reports a present unreadable file', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    notifyAiFeaturesSettingsChanged();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockResolvedValue({
      present: true,
      restricted: true,
      error: 'Invalid policy /etc/varve/policy.json: policy must be a JSON object',
      lockedSettings: [],
    });

    const policy = await beginOrganizationPolicyLoad();
    expect(policy.restricted).toBe(true);
    expect(getAiFeaturesEnabled()).toBe(false);
  });
});
