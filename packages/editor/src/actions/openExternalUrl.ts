import { isTauriRuntime } from '@varve/platform';
import { type ContactChannelId, contactMailto, VARVE_URLS } from '@varve/shared';
import { showEditorToast } from '../context';

function tauriOpenUrl(): ((cmd: string, args: unknown) => Promise<unknown>) | undefined {
  return (
    window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> };
    }
  ).__TAURI_INTERNALS__?.invoke;
}

function copyValueForUrl(url: string): string {
  if (url.startsWith('mailto:')) {
    return url.slice('mailto:'.length).split('?')[0] ?? url;
  }
  return url;
}

export function reportOpenUrlFailure(url: string): void {
  const copyValue = copyValueForUrl(url);
  showEditorToast({
    title: 'Could not open the link',
    message: url,
    type: 'warning',
    action: {
      label: 'Copy',
      onClick: async () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(copyValue);
        }
      },
    },
  });
}

/**
 * Open an https or mailto URL outside the editor.
 *
 * Desktop hands the URL to `tauri-plugin-opener`. The web build opens https
 * in a new tab and assigns mailto on the current window. A failure is never
 * silent: the toast shows the URL and a Copy action.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    if (isTauriRuntime()) {
      const invoke = tauriOpenUrl();
      if (!invoke) {
        reportOpenUrlFailure(url);
        return false;
      }
      await invoke('plugin:opener|open_url', { url });
      return true;
    }

    if (url.startsWith('mailto:')) {
      window.location.href = url;
      return true;
    }

    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      reportOpenUrlFailure(url);
      return false;
    }
    return true;
  } catch {
    reportOpenUrlFailure(url);
    return false;
  }
}

/**
 * Help-menu contact actions.
 *
 * "Send Feedback" opens the public feedback page in a browser. The other
 * channels are real mailbox addresses and stay on mailto.
 */
export function openVarveContact(contact: ContactChannelId): void {
  const url = contact === 'feedback' ? VARVE_URLS.feedback : contactMailto(contact);
  void openExternalUrl(url);
}
