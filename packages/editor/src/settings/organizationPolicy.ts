import { invoke } from '@tauri-apps/api/core';

export interface OrganizationPolicyStatus {
  restricted: boolean;
  lockedSettings: string[];
  aiEnabled?: 'on' | 'off' | 'user';
  updateChecks?: boolean;
  recommended?: Record<string, unknown>;
}

export async function loadOrganizationPolicy(): Promise<OrganizationPolicyStatus> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return { restricted: false, lockedSettings: [] };
  }
  try {
    return await invoke<OrganizationPolicyStatus>('policy_status');
  } catch {
    return { restricted: false, lockedSettings: [] };
  }
}

export function isOrganizationLocked(policy: OrganizationPolicyStatus, key: string): boolean {
  return policy.lockedSettings.includes(key);
}
