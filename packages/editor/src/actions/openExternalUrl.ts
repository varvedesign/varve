import { isTauriRuntime } from '@varve/platform';
import { CONTACT_CHANNELS, type ContactChannelId, contactMailto, VARVE_URLS } from '@varve/shared';
import { showEditorToast } from '../context';

const ALLOWED_EXTERNAL_URLS: ReadonlySet<string> = new Set([
  VARVE_URLS.feedback,
  ...CONTACT_CHANNELS.map((channel) => contactMailto(channel.id)),
]);

function isAllowedExternalUrl(url: string): boolean {
  return ALLOWED_EXTERNAL_URLS.has(url);
}

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
 * Open an allowlisted https or mailto URL outside the editor.
 *
 * Only `VARVE_URLS.feedback` and `contactMailto(id)` for the public contact
 * addresses are accepted. Anything else returns false without calling the
 * native opener or `window.open`.
 *
 * Desktop hands the URL to `tauri-plugin-opener`. The web build opens https
 * in a new tab (`noopener` is kept; browsers then return null even when the
 * tab opens, so a null result is not a failure) and assigns mailto on the
 * current window. A thrown open is never silent: the toast shows the URL
 * and a Copy action.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) {
    return false;
  }

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

    // `noopener` makes the browser return null even when the tab opens.
    // Treat only a thrown call as a failure.
    window.open(url, '_blank', 'noopener,noreferrer');
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
