import type { MenuItemDef } from '../types';
import { a, hasCapability } from './helpers';

export function getHelpMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'openHelp',
      labelKey: 'menu.help.contextualHelp',
      accelerator: a('F1'),
      kind: 'command',
      group: 'help',
      run: () => runAction('openHelp'),
    },
    {
      id: 'openHelpCenter',
      labelKey: 'menu.help.helpCenter',
      kind: 'command',
      group: 'help',
      run: () => runAction('openHelpCenter'),
    },
    {
      id: 'contactSupport',
      labelKey: 'menu.help.contactSupport',
      kind: 'command',
      group: 'contact',
      run: () => runAction('contactSupport'),
    },
    {
      id: 'sendFeedback',
      labelKey: 'menu.help.sendFeedback',
      kind: 'command',
      group: 'contact',
      run: () => runAction('sendFeedback'),
    },
    {
      id: 'reportSecurity',
      labelKey: 'menu.help.reportSecurity',
      kind: 'command',
      group: 'contact',
      run: () => runAction('reportSecurity'),
    },
    {
      id: 'openPrivacy',
      labelKey: 'menu.help.privacy',
      kind: 'command',
      group: 'contact',
      run: () => runAction('openPrivacy'),
    },
    {
      id: 'whatIsThis',
      labelKey: 'menu.help.whatIsThis',
      accelerator: a('F1', false, false, true),
      kind: 'command',
      group: 'help',
      run: () => runAction('whatIsThis'),
    },
    {
      id: 'startTour',
      labelKey: 'menu.help.startTour',
      kind: 'command',
      group: 'about',
      run: () => runAction('startTour'),
    },
    {
      id: 'about',
      labelKey: 'menu.help.about',
      kind: 'command',
      group: 'about',
      run: () => runAction('about'),
    },
    {
      id: 'installDesktopApp',
      labelKey: 'menu.help.installDesktopApp',
      kind: 'command',
      group: 'install',
      visible: (ctx) => {
        if (hasCapability(ctx, 'nativeMenu')) return false;
        try {
          if (
            typeof localStorage !== 'undefined' &&
            (localStorage.getItem('varve-install-desktop-dismissed') ??
              localStorage.getItem('strata-install-desktop-dismissed')) === 'true'
          )
            return false;
        } catch {
          return false;
        }
        try {
          if (typeof window !== 'undefined' && window.self !== window.top) return false;
        } catch {
          return false;
        }
        return true;
      },
      run: () => runAction('installDesktopApp'),
    },
  ];
}
