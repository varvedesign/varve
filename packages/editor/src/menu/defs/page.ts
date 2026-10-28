import type { MenuItemDef } from '../types';

export function getPageMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'createMaster',
      labelKey: 'menu.page.createMaster',
      kind: 'command',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.currentPageIsMaster) {
          return { reason: 'This page is already a master.' };
        }
        return true;
      },
      run: () => runAction('createMaster'),
    },
    {
      id: 'applyMaster',
      labelKey: 'menu.page.applyMaster',
      kind: 'submenu',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.masterPages.length === 0) {
          return { reason: 'No master pages yet \u2014 create one first.' };
        }
        if (!ctx.document.activePageId) {
          return { reason: 'No active page selected.' };
        }
        return true;
      },
      items: (ctx) => {
        const masters = ctx.document.masterPages;
        const current = ctx.document.currentPageMaster;
        const activeId = ctx.document.activePageId;
        const items: MenuItemDef[] = [];

        const candidates = activeId ? masters.filter((m) => m.id !== activeId) : masters;

        for (const m of candidates) {
          items.push({
            id: `applyMaster:${m.id}`,
            labelKey: m.name,
            kind: 'radio',
            radioGroup: 'masterApply',
            checked: () => current?.id === m.id,
            run: () => runAction(`applyMaster:${m.id}`),
          });
        }

        if (candidates.length > 0) {
          items.push({
            id: 'applyMasterSep',
            labelKey: '---',
            kind: 'separator',
            group: 'master',
          });
        }

        items.push({
          id: 'applyMasterNone',
          labelKey: 'menu.page.applyMasterNone',
          kind: 'radio',
          radioGroup: 'masterApply',
          checked: () => current == null,
          run: () => runAction('applyMaster:'),
        });

        return items;
      },
      run: () => {},
    },
    {
      id: 'detachMaster',
      labelKey: 'menu.page.detachMaster',
      label: (ctx) => {
        const m = ctx.document.currentPageMaster;
        return m ? `Detach from '${m.name}'` : 'Detach from Master';
      },
      kind: 'command',
      group: 'master',
      workspaces: ['design', 'print'],
      enabled: (ctx) => {
        if (ctx.document.currentPageMaster) return true;
        return { reason: 'This page has no master.' };
      },
      run: () => runAction('detachMaster'),
    },
  ];
}
