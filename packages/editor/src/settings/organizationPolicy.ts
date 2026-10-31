import { invoke } from '@tauri-apps/api/core';
import { type AiPolicyMode, configureAiPolicyOverride } from '@varve/engine';

export const POLICY_UNREADABLE_HINT =
  "Your organisation's Varve policy has errors. AI and network features are off until IT fixes it. Your work is not affected.";

export interface OrganizationPolicyStatus {
  present?: boolean;
  restricted: boolean;
  error?: string | null;
  lockedSettings: string[];
  aiEnabled?: 'on' | 'off' | 'user';
  updateChecks?: boolean;
  recommended?: Record<string, unknown>;
}

type OrganizationAiPolicyInput = Pick<OrganizationPolicyStatus, 'aiEnabled' | 'error'> & {
  restricted?: boolean;
};

export function resolveOrganizationAiMode(policy: OrganizationAiPolicyInput): AiPolicyMode {
  // A policy file that exists but cannot be read or parsed fails closed.
  if (policy.error || policy.restricted) return 'off';
  if (policy.aiEnabled === 'on' || policy.aiEnabled === 'off' || policy.aiEnabled === 'user') {
    return policy.aiEnabled;
  }
  return 'user';
}

/** Push the administrator AI mode into the engine gate. Safe to call from web (no-op overlay). */
export function applyOrganizationAiPolicy(policy: OrganizationAiPolicyInput): void {
  configureAiPolicyOverride(resolveOrganizationAiMode(policy));
}

function isTauriWindow(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function unreadableOrganizationPolicy(reason: string): OrganizationPolicyStatus {
  return {
    present: true,
    restricted: true,
    error: reason,
    lockedSettings: [],
    aiEnabled: 'off',
  };
}

export async function loadOrganizationPolicy(): Promise<OrganizationPolicyStatus> {
  if (!isTauriWindow()) {
    return { present: false, restricted: false, lockedSettings: [] };
  }
  try {
    return await invoke<OrganizationPolicyStatus>('policy_status');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unreadableOrganizationPolicy(
      `Could not read the organisation policy (${detail}). AI features are off until it can be read.`,
    );
  }
}

let inFlight: Promise<OrganizationPolicyStatus> | null = null;

/** Test-only: drop the in-flight load so the next begin() starts fresh. */
export function resetOrganizationPolicyLoadForTests(): void {
  inFlight = null;
  configureAiPolicyOverride('user');
}

/**
 * Apply admin policy before any model path can run. On desktop, AI is held
 * off until `policy_status` returns so a leftover user-on setting cannot
 * load weights during the gap. Web has no policy file.
 */
export function beginOrganizationPolicyLoad(): Promise<OrganizationPolicyStatus> {
  if (inFlight) return inFlight;
  if (isTauriWindow()) {
    configureAiPolicyOverride('off');
  }
  inFlight = loadOrganizationPolicy().then((policy) => {
    applyOrganizationAiPolicy(policy);
    return policy;
  });
  return inFlight;
}

if (typeof window !== 'undefined') {
  void beginOrganizationPolicyLoad();
}

export function isOrganizationLocked(policy: OrganizationPolicyStatus, key: string): boolean {
  return policy.lockedSettings.includes(key);
}
