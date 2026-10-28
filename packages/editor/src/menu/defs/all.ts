import { SHORTCUT_DEFS } from '../../shortcuts/ShortcutManager';
import type { MenuContext, MenuItemDef } from '../types';
import { getArrangeMenu } from './arrange';
import { getEditMenu } from './edit';
import { getFileMenu } from './file';
import { getHelpMenu } from './help';
import { getObjectMenu } from './object';
import { getPageMenu } from './page';
import { getTextMenu } from './text';
import { getViewMenu } from './view';

export interface MenuDefsOptions {
  runAction: (id: string) => void;
  getTheme?: () => string;
}

function withCanonicalAccelerators(items: MenuItemDef[]): MenuItemDef[] {
  return items.map((item) => {
    const shortcut = SHORTCUT_DEFS[item.id as keyof typeof SHORTCUT_DEFS];
    const itemChildren = item.items;
    const nestedItems = Array.isArray(itemChildren)
      ? withCanonicalAccelerators(itemChildren)
      : typeof itemChildren === 'function'
        ? (ctx: MenuContext) => withCanonicalAccelerators(itemChildren(ctx))
        : undefined;

    return {
      ...item,
      ...(shortcut ? { accelerator: { ...shortcut.binding } } : {}),
      ...(nestedItems ? { items: nestedItems } : {}),
    };
  });
}

export function getAllMenuDefs(opts: MenuDefsOptions): MenuItemDef[] {
  return withCanonicalAccelerators([
    {
      id: 'file',
      labelKey: 'menu.file',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getFileMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'edit',
      labelKey: 'menu.edit',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getEditMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'text',
      labelKey: 'menu.text',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getTextMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'view',
      labelKey: 'menu.view',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getViewMenu(opts.runAction, { getTheme: opts.getTheme }),
      run: () => {},
    },
    {
      id: 'object',
      labelKey: 'menu.object',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getObjectMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'arrange',
      labelKey: 'menu.arrange',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getArrangeMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'page',
      labelKey: 'menu.page',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getPageMenu(opts.runAction),
      run: () => {},
    },
    {
      id: 'help',
      labelKey: 'menu.help',
      kind: 'submenu',
      contexts: ['menubar'],
      items: getHelpMenu(opts.runAction),
      run: () => {},
    },
  ]);
}
