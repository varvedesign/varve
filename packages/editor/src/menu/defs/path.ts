import type { MenuItemDef } from '../types';
import { a, enabledWithSelection } from './helpers';

function getPathSubmenuItems(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'expandStroke',
      labelKey: 'menu.object.expandStroke',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('expandStroke'),
    },
    {
      id: 'offsetPath',
      labelKey: 'menu.object.offsetPath',
      accelerator: a('o', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('offsetPath'),
    },
    {
      id: 'roundCorners',
      labelKey: 'menu.object.roundCorners',
      accelerator: a('c', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('roundCorners'),
    },
    {
      id: 'simplifyPath',
      labelKey: 'menu.object.simplifyPath',
      accelerator: a('w', true, true),
      kind: 'command',
      group: 'path',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('simplifyPath'),
    },
    {
      id: 'mirrorDuplicateHorizontal',
      labelKey: 'menu.object.mirrorDuplicateHorizontal',
      accelerator: a('h', true, true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('mirrorDuplicateHorizontal'),
    },
    {
      id: 'mirrorDuplicateVertical',
      labelKey: 'menu.object.mirrorDuplicateVertical',
      accelerator: a('v', true, true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('mirrorDuplicateVertical'),
    },
    {
      id: 'radialDuplicate',
      labelKey: 'menu.object.radialDuplicate',
      accelerator: a('r', true, true),
      kind: 'command',
      group: 'duplicate-transforms',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('radialDuplicate'),
    },
  ];
}

export function getPathSubmenuEntry(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'path',
      labelKey: 'menu.object.path',
      kind: 'submenu',
      group: 'path',
      items: getPathSubmenuItems(runAction),
      enabled: enabledWithSelection,
      run: () => {},
    },
  ];
}
