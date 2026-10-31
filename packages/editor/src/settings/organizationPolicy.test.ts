import { describe, expect, it } from 'vitest';
import { isOrganizationLocked, type OrganizationPolicyStatus } from './organizationPolicy';

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
