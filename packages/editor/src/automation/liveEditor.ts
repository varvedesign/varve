/**
 * The window's automation controller and the seam the editor publishes into.
 *
 * `publishEditorToAutomation` is called from `registerEditorActions`, which the
 * shell re-runs on every state change, so the controller always has the editor's
 * current context without a hub file importing it.
 *
 * **This module is deliberately tiny and the controller is not.** The
 * controller pulls in the schema validator, the command catalog and the
 * executor: a large amount of code for a feature that is off by default, in an
 * application that targets low memory and a fast start. So the controller is
 * loaded by dynamic import the first time a person turns automation on, and
 * until then publishing the editor stores one reference and returns.
 */
import type { EditorContextValue } from '../context';
import type { AutomationController, ControllerOptions } from './controller';

let controller: AutomationController | null = null;
let loading: Promise<AutomationController> | null = null;
let published: EditorContextValue | null = null;

function randomId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The controller if automation has ever been turned on in this window. */
export function peekAutomationController(): AutomationController | null {
  return controller;
}

const loadedListeners = new Set<(controller: AutomationController) => void>();

/**
 * Call `listener` with the controller as soon as it exists: immediately when it
 * already does, otherwise when it is first loaded. Lets a status surface follow
 * the controller without ever being the thing that loads it.
 */
export function whenAutomationControllerLoaded(
  listener: (controller: AutomationController) => void,
): () => void {
  if (controller) {
    listener(controller);
    return () => undefined;
  }
  loadedListeners.add(listener);
  return () => {
    loadedListeners.delete(listener);
  };
}

/** Load (once) and return the controller, handing it the editor published so far. */
export function loadAutomationController(
  overrides: Partial<ControllerOptions> = {},
): Promise<AutomationController> {
  if (!loading) {
    loading = import('./controller').then((module) => {
      const created = new module.AutomationController({
        instanceId: `window-${randomId()}`,
        serverInfo: { name: 'varve-editor', version: '0' },
        ...overrides,
      });
      controller = created;
      if (published) created.attach(published);
      for (const listener of [...loadedListeners]) listener(created);
      loadedListeners.clear();
      return created;
    });
  }
  return loading;
}

const documentWatchers = new Set<() => void>();
let announcedDocumentId: string | null = null;

export function publishEditorToAutomation(editor: EditorContextValue): void {
  published = editor;
  controller?.attach(editor);
  if (documentWatchers.size === 0) return;
  // Only when somebody is waiting on it: read the synchronous accessor and
  // wake watchers when the document the editor shows has changed.
  const id = editor.readAutomationState().document.id;
  if (id === announcedDocumentId) return;
  announcedDocumentId = id;
  for (const watcher of [...documentWatchers]) watcher();
}

/**
 * Be told when the editor starts showing a different document (including the
 * first one). The listener is called with no arguments; read
 * `currentDocumentIdentity()` for what changed.
 */
export function watchDocumentChanges(listener: () => void): () => void {
  documentWatchers.add(listener);
  // A watcher that arrives after the editor published still needs the baseline.
  if (published && announcedDocumentId === null) {
    announcedDocumentId = published.readAutomationState().document.id;
  }
  return () => {
    documentWatchers.delete(listener);
  };
}

/**
 * Identity of the document session the editor is showing right now, or `null`
 * before the editor has published. Read through the editor's synchronous
 * accessor, so it never lags the render.
 */
export function currentDocumentIdentity(): { sessionId: string; id: string; name: string } | null {
  if (!published) return null;
  const now = published.readAutomationState();
  return { sessionId: now.sessionId, id: now.document.id, name: now.document.name };
}

/** For tests: drop everything so each test starts with automation never loaded. */
export function resetAutomationControllerForTesting(): void {
  controller = null;
  loading = null;
  published = null;
  announcedDocumentId = null;
  documentWatchers.clear();
  loadedListeners.clear();
}
