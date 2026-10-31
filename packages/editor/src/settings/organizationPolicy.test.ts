import {
  configureAiPolicyOverride,
  getAiFeaturesEnabled,
  notifyAiFeaturesSettingsChanged,
} from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOrganizationAiPolicy,
  isOrganizationLocked,
  type OrganizationPolicyStatus,
} from './organizationPolicy';

describe('organization settings locks', () => {
  it('locks only keys listed by the administrator', () => {
    const policy: OrganizationPolicyStatus = {
      restricted: true,
      lockedSettings: ['updates.check'],
    };
    expect(isOrganizationLocked(policy, 'updates.check')).toBe(true);
    expect(isOrganizationLocked(policy, 'ai.enabled')).toBe(false);
  });
});

describe('organization AI policy overlay', () => {
  afterEach(() => {
    localStorage.clear();
    configureAiPolicyOverride('user');
    notifyAiFeaturesSettingsChanged();
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
});
