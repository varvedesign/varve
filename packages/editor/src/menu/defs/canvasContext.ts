import type { MenuItemDef } from '../types';
import { enabledWithMultiSelection, enabledWithSelection, enabledWithSingleGroup } from './helpers';

export function getCanvasContextMenuDefs(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'ctx-cut',
      labelKey: 'menu.edit.cut',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('cut'),
    },
    {
      id: 'ctx-copy',
      labelKey: 'menu.edit.copy',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('copy'),
    },
    {
      id: 'ctx-paste',
      labelKey: 'menu.edit.paste',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      run: () => runAction('paste'),
    },
    {
      id: 'ctx-copyText',
      labelKey: 'menu.edit.copyText',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('copyText'),
    },
    {
      id: 'ctx-copyAsSvg',
      labelKey: 'menu.edit.copyAsSvg',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('copyAsSvg'),
    },
    {
      id: 'ctx-copyAsPng',
      labelKey: 'menu.edit.copyAsPng',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('copyAsPng'),
    },
    {
      id: 'ctx-pastePlainText',
      labelKey: 'menu.edit.pastePlainText',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      run: () => runAction('pastePlainText'),
    },
    {
      id: 'ctx-pasteSvgMarkup',
      labelKey: 'menu.edit.pasteSvgMarkup',
      kind: 'command',
      group: 'clipboard',
      contexts: ['canvas'],
      run: () => runAction('pasteSvgMarkup'),
    },
    {
      id: 'ctx-duplicate',
      labelKey: 'menu.edit.duplicate',
      kind: 'command',
      group: 'edit-op',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      run: () => runAction('duplicate'),
    },
    {
      id: 'ctx-delete',
      labelKey: 'menu.edit.delete',
      kind: 'command',
      group: 'edit-op',
      contexts: ['canvas'],
      enabled: enabledWithSelection,
      destructive: true,
      run: () => runAction('delete'),
    },
    {
      id: 'ctx-group',
      labelKey: 'menu.object.group',
      kind: 'command',
      group: 'grouping',
      contexts: ['canvas'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('group'),
    },
    {
      id: 'ctx-ungroup',
      labelKey: 'menu.object.ungroup',
      kind: 'command',
      group: 'grouping',
      contexts: ['canvas'],
      enabled: enabledWithSingleGroup,
      run: () => runAction('ungroup'),
    },
    {
      id: 'ctx-intel',
      labelKey: 'Intelligence',
      kind: 'submenu',
      group: 'intel',
      contexts: ['canvas'],
      enabled: (ctx) => {
        if (ctx.document.nodeCount >= 1) return true;
        return { reason: 'Document is empty' };
      },
      badge: (ctx) => {
        if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
        return undefined;
      },
      items: [
        {
          id: 'ctx-auditSelection',
          labelKey: 'Audit Selection',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select a layer to audit' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'ctx-scanDebt',
          labelKey: 'Scan for Debt',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'No layers to scan' };
          },
          badge: (ctx) => {
            if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
            return undefined;
          },
          run: () => runAction('scanDebt'),
        },
        {
          id: 'ctx-suggestNames',
          labelKey: 'Suggest Names',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select one or more layers' };
          },
          run: () => runAction('suggestNames'),
        },
        {
          id: 'ctx-detectDuplicates',
          labelKey: 'Detect Duplicates in Selection',
          kind: 'command',
          group: 'intel',
          contexts: ['canvas'],
          label: (ctx) => {
            if (ctx.selection.count >= 1) return 'Detect Duplicates in Selection';
            return 'Detect Duplicates on Page';
          },
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 2) return true;
            return { reason: 'Need at least 2 layers to detect duplicates' };
          },
          run: () => runAction('detectDuplicates'),
        },
      ],
      run: () => {},
    },
    {
      id: 'ctx-selectAll',
      labelKey: 'menu.edit.selectAll',
      kind: 'command',
      group: 'selection',
      contexts: ['canvas'],
      run: () => runAction('selectAll'),
    },
  ];
}
