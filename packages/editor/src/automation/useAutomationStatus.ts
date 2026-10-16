/**
 * What the Settings surface shows about connected mode, and the few things a
 * person can do about it.
 *
 * Reads the mount's status always, and the controller's only once it has been
 * loaded: opening Settings must not be the thing that loads the automation
 * system. Every action goes through the controller the person owns; none of it
 * is reachable from a request.
 */

import type { ApprovalDecision } from '@varve/automation';
import { useCallback, useEffect, useState } from 'react';
import type { ControllerStatus } from './controller';
import { getAutomationMount, type MountStatus } from './desktopMount';
import { peekAutomationController, whenAutomationControllerLoaded } from './liveEditor';

export interface AutomationView {
  mount: MountStatus;
  /** `null` until a person has turned automation on at least once. */
  controller: ControllerStatus | null;
  pause(): void;
  resume(): void;
  revoke(principalId: string): void;
  decide(receiptId: string, decision: ApprovalDecision): void;
}

export function useAutomationStatus(): AutomationView {
  const mount = getAutomationMount();
  const [mountStatus, setMountStatus] = useState<MountStatus>(mount.status());
  const [controllerStatus, setControllerStatus] = useState<ControllerStatus | null>(() => {
    return peekAutomationController()?.status() ?? null;
  });

  useEffect(() => {
    setMountStatus(mount.status());
    const stopMount = mount.onChange(setMountStatus);
    let stopController: (() => void) | null = null;
    // Follows the controller once it exists; never loads it.
    const stopLoaded = whenAutomationControllerLoaded((controller) => {
      setControllerStatus(controller.status());
      stopController = controller.onChange(setControllerStatus);
    });
    return () => {
      stopMount();
      stopLoaded();
      stopController?.();
    };
  }, [mount]);

  return {
    mount: mountStatus,
    controller: controllerStatus,
    pause: useCallback(() => peekAutomationController()?.pause(), []),
    resume: useCallback(() => peekAutomationController()?.resume(), []),
    revoke: useCallback((principalId: string) => {
      peekAutomationController()?.revoke(principalId);
    }, []),
    decide: useCallback((receiptId: string, decision: ApprovalDecision) => {
      peekAutomationController()?.decide(receiptId, decision);
    }, []),
  };
}
