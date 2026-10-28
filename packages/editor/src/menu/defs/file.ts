import { labelWithFallback, loadEntries } from '../../recentFiles/store';
import type { MenuItemDef } from '../types';
import { a, hasCapability } from './helpers';

export function getFileMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    // ── Create ──
    {
      id: 'new',
      labelKey: 'menu.file.new',
      accelerator: a('n', true),
      kind: 'command',
      group: 'create',
      run: () => runAction('new'),
    },
    {
      id: 'newLogoProject',
      labelKey: 'menu.file.newLogoProject',
      accelerator: a('n', true, false, true),
      kind: 'command',
      group: 'create',
      run: () => runAction('newLogoProject'),
    },
    {
      id: 'logo',
      labelKey: 'menu.file.logo',
      kind: 'submenu',
      group: 'create',
      items: [
        {
          id: 'createLogoConcept',
          labelKey: 'menu.file.createLogoConcept',
          accelerator: a('1', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createLogoConcept'),
        },
        {
          id: 'duplicateLogoConcept',
          labelKey: 'menu.file.duplicateLogoConcept',
          accelerator: a('2', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('duplicateLogoConcept'),
        },
        {
          id: 'createLogoVariant',
          labelKey: 'menu.file.createLogoVariant',
          kind: 'command',
          group: 'create',
          run: () => runAction('createLogoVariant'),
        },
        {
          id: 'createMonochromeVariant',
          labelKey: 'menu.file.createMonochromeVariant',
          accelerator: a('m', true, true, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createMonochromeVariant'),
        },
        {
          id: 'createReversedVariant',
          labelKey: 'menu.file.createReversedVariant',
          accelerator: a('q', true, false, true),
          kind: 'command',
          group: 'create',
          run: () => runAction('createReversedVariant'),
        },
      ],
      run: () => {},
    },
    // ── Open / Import ──
    {
      id: 'open',
      labelKey: 'menu.file.open',
      accelerator: a('o', true),
      kind: 'command',
      group: 'open',
      run: () => runAction('open'),
    },
    {
      id: 'openRecent',
      labelKey: 'Open Recent',
      kind: 'submenu',
      group: 'open',
      items: (): MenuItemDef[] => {
        try {
          const entries = loadEntries().slice(0, 10);
          if (entries.length === 0) {
            return [
              {
                id: 'noRecent',
                labelKey: 'No Recent Files',
                kind: 'command',
                enabled: () => ({ reason: 'No recently opened files yet' }),
                run: () => {},
              },
            ];
          }
          const items: MenuItemDef[] = entries.map((e) => ({
            id: `recent:${e.id}`,
            labelKey: e.label,
            label: () => labelWithFallback(e.label),
            kind: 'command',
            group: 'recent',
            run: () => runAction(`recent:${e.id}`),
          }));
          items.push(
            { id: 'recent-sep', kind: 'separator', group: 'recent', run: () => {} },
            {
              id: 'clearRecent',
              labelKey: 'Clear Recent Files',
              kind: 'command',
              group: 'recent',
              destructive: true,
              run: () => runAction('clearRecent'),
            },
          );
          return items;
        } catch {
          return [];
        }
      },
      run: () => {},
    },
    {
      id: 'reopenLast',
      labelKey: 'Reopen Last File',
      accelerator: a('t', true, true),
      kind: 'command',
      group: 'open',
      run: () => runAction('reopenLast'),
    },
    {
      id: 'import',
      labelKey: 'menu.file.import',
      accelerator: a('i', true),
      kind: 'command',
      group: 'open',
      run: () => runAction('import'),
    },
    {
      id: 'quickConvert',
      labelKey: 'menu.file.quickConvert',
      kind: 'command',
      group: 'open',
      run: () => runAction('quickConvert'),
    },
    {
      id: 'insertIcon',
      labelKey: 'menu.file.insertIcon',
      accelerator: a('i', true, true, true),
      kind: 'command',
      group: 'open',
      run: () => runAction('insertIcon'),
    },
    {
      id: 'createTableFromClipboard',
      labelKey: 'menu.file.createTableFromClipboard',
      kind: 'command',
      group: 'open',
      run: () => runAction('createTableFromClipboard'),
    },
    // ── Close ──
    {
      id: 'tabClose',
      labelKey: 'menu.file.closeDocument',
      kind: 'command',
      group: 'close',
      run: () => runAction('tabClose'),
    },
    {
      id: 'closeWindow',
      labelKey: 'menu.file.closeWindow',
      kind: 'command',
      group: 'close',
      run: () => runAction('closeWindow'),
    },
    // ── Save ──
    {
      id: 'save',
      labelKey: 'menu.file.save',
      accelerator: a('s', true),
      kind: 'command',
      group: 'save',
      run: () => runAction('save'),
    },
    {
      id: 'saveAs',
      labelKey: 'menu.file.saveAs',
      accelerator: a('s', true, true),
      kind: 'command',
      group: 'save',
      run: () => runAction('saveAs'),
    },
    {
      id: 'saveCopy',
      labelKey: 'menu.file.saveCopy',
      kind: 'command',
      group: 'save',
      run: () => runAction('saveCopy'),
    },
    // ── Export ──
    {
      id: 'exportSvg',
      labelKey: 'menu.file.exportSvg',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'export',
      run: () => runAction('exportSvg'),
    },
    {
      id: 'export',
      labelKey: 'menu.file.export',
      accelerator: a('e', true),
      kind: 'command',
      group: 'export',
      run: () => runAction('export'),
    },
    // ── Document metadata ──
    {
      id: 'setFileThumbnail',
      labelKey: 'Set File Thumbnail…',
      kind: 'command',
      group: 'info',
      run: () => runAction('openThumbnailPicker'),
    },
    {
      id: 'documentInfo',
      labelKey: 'menu.file.documentInfo',
      kind: 'command',
      group: 'info',
      run: () => runAction('documentInfo'),
    },
    // ── Archive / backup ──
    {
      id: 'archiveBackup',
      labelKey: 'menu.file.archiveBackup',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => hasCapability(ctx, 'archive'),
      run: () => runAction('archiveBackup'),
    },
    {
      id: 'archiveRestore',
      labelKey: 'menu.file.archiveRestore',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => hasCapability(ctx, 'archive'),
      run: () => runAction('archiveRestore'),
    },
    {
      id: 'downloadSnapshot',
      labelKey: 'menu.file.downloadSnapshot',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => !hasCapability(ctx, 'archive'),
      run: () => runAction('downloadSnapshot'),
    },
    {
      id: 'restoreFromSnapshot',
      labelKey: 'menu.file.restoreFromSnapshot',
      kind: 'command',
      group: 'archive',
      visible: (ctx) => !hasCapability(ctx, 'archive'),
      run: () => runAction('restoreFromSnapshot'),
    },
    // ── Settings ──
    {
      id: 'managePlugins',
      labelKey: 'menu.file.managePlugins',
      kind: 'command',
      group: 'settings',
      run: () => runAction('managePlugins'),
    },
    {
      id: 'settings',
      labelKey: 'menu.file.settings',
      accelerator: a(',', true),
      kind: 'command',
      group: 'settings',
      run: () => runAction('settings'),
    },
    // ── Quit (terminal; macOS hosts it in the native app menu) ──
    {
      id: 'quitApp',
      labelKey: 'menu.file.quit',
      kind: 'command',
      group: 'quit',
      visible: (ctx) => ctx.platform.os !== 'mac',
      run: () => runAction('quitApp'),
    },
  ];
}
