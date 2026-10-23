import { type ContactChannelId, contactChannel, contactMailto } from '@varve/shared';
import { type ReactNode, useCallback, useState } from 'react';
import { openExternalUrl } from '../actions/registerAll';
import './ContactLink.css';

/**
 * ContactLink — a public Varve contact address, rendered as a real mail link
 * with a copy fallback.
 *
 * A bare `<a href="mailto:...">` is not sufficient in this application. In a
 * Tauri webview the default navigation for an external protocol is commonly
 * dropped (WebKitGTK), so the link looks correct, is focusable, announces
 * correctly — and does nothing when clicked. Routing the activation through
 * `openExternalUrl` hands the URL to the native opener on desktop and falls
 * back to a normal navigation on the web build. If that still fails, the
 * opener shows a toast with the address and a Copy button.
 *
 * The element stays an anchor with a real `href` on purpose, rather than
 * becoming a button:
 *  - "Copy email address" in the context menu keeps working;
 *  - the address is selectable and copyable with no mail client installed;
 *  - assistive technology announces it as a link to a mail address, which is
 *    what it is.
 *
 * A visible Copy button is the fallback for machines with no mail client:
 * the address can still be copied in one click.
 *
 * `aria-label` defaults to the channel's distinguishing label ("Email Varve
 * product support") because several of these can appear near each other, and
 * "support@varve.studio" read out of context does not convey purpose.
 */
export function ContactLink({
  channel,
  children,
  className,
  ariaLabel,
}: {
  channel: ContactChannelId;
  /** Defaults to the address itself, which must remain visible and copyable. */
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const contact = contactChannel(channel);
  const href = contactMailto(channel);
  const [copied, setCopied] = useState(false);
  const canCopy =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contact.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [contact.email]);

  return (
    <span className="contact-link">
      <a
        className={className}
        href={href}
        aria-label={ariaLabel ?? contact.linkLabel}
        onClick={(event) => {
          // Let the user's own modifiers (new tab/window) and non-primary
          // buttons behave normally; only take over the plain activation.
          if (event.defaultPrevented) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (event.button !== 0) return;
          event.preventDefault();
          void openExternalUrl(href);
        }}
      >
        {children ?? contact.email}
      </a>
      {canCopy && (
        <button
          type="button"
          className="contact-link__copy"
          aria-label={`Copy ${contact.email} to the clipboard`}
          onClick={() => void copyAddress()}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </span>
  );
}
