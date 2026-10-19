import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Retry drain shortly after mount: on macOS the `Opened` run event can
 *  arrive a beat after the webview is up, and the event itself is not
 *  replayed — draining twice makes startup racing harmless. */
const STARTUP_DRAIN_RETRY_MS = 1500;

export type OsFileOpenHandler = (path: string) => void;
export type OsFileOpenErrorHandler = (message: string) => void;

/**
 * Arm OS-level "Open With" intake (.varve / .strata file associations).
 *
 * Two channels, one outcome: Rust queues opened paths and rejected-path
 * messages for IPC drains, and emits live events while the webview is
 * running. Draining at mount covers startup events that raced the webview;
 * live events cover subsequent requests. The caller dedupes opened paths,
 * while this bridge briefly dedupes an error delivered by both channels.
 *
 * Browser builds short-circuit: there is no OS open event in a webview.
 */
export async function armOsFileOpen(
  handle: OsFileOpenHandler,
  handleError: OsFileOpenErrorHandler,
): Promise<() => void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return () => undefined;
  }

  const drain = async () => {
    try {
      const pending = (await invoke<string[]>('take_pending_open_files')) ?? [];
      for (const path of pending) handle(path);
    } catch {
      // Not a Tauri webview — nothing to drain.
    }
  };

  const seenErrors = new Set<string>();
  const reportErrors = (messages: string[]) => {
    for (const message of messages) {
      if (seenErrors.has(message)) continue;
      seenErrors.add(message);
      handleError(message);
      window.setTimeout(() => seenErrors.delete(message), 2000);
    }
  };

  const drainErrors = async () => {
    try {
      const pending = (await invoke<string[]>('take_pending_open_errors')) ?? [];
      reportErrors(pending);
    } catch {
      // Not a Tauri webview — nothing to drain.
    }
  };

  const unlisten = await listen<string[]>('varve:file-open', (event) => {
    for (const path of event.payload ?? []) handle(path);
  });
  const unlistenErrors = await listen<string[]>('varve:file-open-error', (event) => {
    reportErrors(event.payload ?? []);
  });

  void drain();
  void drainErrors();
  const retry = window.setTimeout(() => void drain(), STARTUP_DRAIN_RETRY_MS);

  return () => {
    window.clearTimeout(retry);
    void unlisten();
    void unlistenErrors();
  };
}
