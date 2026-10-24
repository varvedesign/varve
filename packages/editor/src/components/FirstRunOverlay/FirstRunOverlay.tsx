import { Button, Dialog, Icon, type IconName } from '@varve/ui';
import { useState } from 'react';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { actionAriaKeyShortcut, actionShortcutLabel } from '../../shortcuts/toolShortcutLabel';
import {
  getLocalStorage,
  markFirstRunOverlayDismissed,
  readFirstRunOverlayVisibility,
} from './firstRunOverlayState';
import './FirstRunOverlay.css';

interface FirstRunOverlayProps {
  onDismiss?: () => void;
}

/**
 * Starting points. Each is a registered action, so choosing one does exactly
 * what its shortcut does, and the key shown is the user's effective binding.
 */
const STARTS: readonly { action: string; label: string; detail: string; icon: IconName }[] = [
  {
    action: 'toolFrame',
    label: 'Draw a frame',
    detail: 'A screen, page, or artboard to design in',
    icon: 'Frame',
  },
  {
    action: 'toolRect',
    label: 'Draw a shape',
    detail: 'Rectangle first; ellipse, line and more in the toolbar',
    icon: 'Square',
  },
  {
    action: 'toolText',
    label: 'Add text',
    detail: 'Click to type a line, drag for a text box',
    icon: 'Type',
  },
  {
    action: 'shortcutPalette',
    label: 'Find any command',
    detail: 'Search every action by name',
    icon: 'Search',
  },
];

const START_HERE_URL = 'https://varve.studio/docs/start-here?ref=first-run-overlay';

/**
 * The first-run start panel: one dialog with four starting points instead of
 * a three-step carousel (shell audit 2026-10-22, F-45). It is a real modal
 * dialog — focus moves in, Tab stays inside, Escape closes, focus returns —
 * and every way of leaving it is remembered.
 */
export function FirstRunOverlay({ onDismiss }: FirstRunOverlayProps) {
  const [visible, setVisible] = useState(() => readFirstRunOverlayVisibility(getLocalStorage()));
  if (!visible) return null;

  const dismiss = () => {
    markFirstRunOverlayDismissed();
    setVisible(false);
    onDismiss?.();
  };

  const start = (action: string) => {
    dismiss();
    // After the dialog has closed, so a surface the action opens (the command
    // palette, Help) can take focus.
    requestAnimationFrame(() => getActionRegistry().dispatch(action));
  };

  const helpKey = actionShortcutLabel('openHelp');

  return (
    <Dialog
      open
      onClose={dismiss}
      title="Welcome to Varve"
      className="first-run-overlay"
      dismissible
      focusFirstControl
      footer={
        <div className="first-run__footer">
          <Button
            variant="ghost"
            onClick={() => start('openHelp')}
            aria-keyshortcuts={actionAriaKeyShortcut('openHelp')}
          >
            Open Help
            {helpKey ? <kbd className="first-run__key">{helpKey}</kbd> : null}
          </Button>
          <Button onClick={dismiss}>Start with a blank canvas</Button>
        </div>
      }
    >
      <p className="first-run__lede">
        Design, illustrate, and publish on your own machine. Pick a starting point; the key on the
        right does the same thing any time.
      </p>
      <ul className="first-run__starts" aria-label="Starting points">
        {STARTS.map((item) => {
          const key = actionShortcutLabel(item.action);
          return (
            <li key={item.action}>
              <Button
                variant="outline"
                className="first-run__start"
                onClick={() => start(item.action)}
                aria-keyshortcuts={actionAriaKeyShortcut(item.action)}
              >
                <Icon name={item.icon} size={20} />
                <span className="first-run__start-text">
                  <span className="first-run__start-label">{item.label}</span>
                  <span className="first-run__start-detail">{item.detail}</span>
                </span>
                {key ? <kbd className="first-run__key">{key}</kbd> : null}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="first-run__more">
        Help explains whatever is in front of you. New to design tools? Read the{' '}
        <a href={START_HERE_URL} target="_blank" rel="noopener noreferrer">
          Start Here guide
        </a>
        .
      </p>
    </Dialog>
  );
}
