/**
 * The window's automation controller and the seam the editor publishes into.
 *
 * `publishEditorToAutomation` is called from `registerEditorActions`, which the
 * shell re-runs on every state change, so the controller always has the editor's
 * current context without a hub file importing it. While automation is off the
 * call stores one reference and returns.
 */
import type { EditorContextValue } from '../context';
import { AutomationController } from './controller';

let controller: AutomationController | null = null;

function randomId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAutomationController(): AutomationController {
  if (!controller) {
    controller = new AutomationController({
      instanceId: `window-${randomId()}`,
      serverInfo: { name: 'varve-editor', version: '0' },
    });
  }
  return controller;
}

export function publishEditorToAutomation(editor: EditorContextValue): void {
  getAutomationController().attach(editor);
}

/** For tests: drop the singleton so each test starts with automation off. */
export function resetAutomationControllerForTesting(): void {
  controller = null;
}
