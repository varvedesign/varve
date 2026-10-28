import type { MenuItemDef } from '../types';

export function getObjectIntelligenceMenuItems(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'audit',
      labelKey: 'menu.object.audit',
      kind: 'submenu',
      group: 'intelligence',
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.document.nodeCount >= 1) return true;
        return { reason: 'Document is empty' };
      },
      badge: (ctx) => {
        if (ctx.intelligence.findingCount > 0) return `${ctx.intelligence.findingCount}`;
        return undefined;
      },
      items: [
        {
          id: 'auditSelection',
          labelKey: 'Audit Selection',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.selection.count >= 1) return true;
            return { reason: 'Select a layer to audit' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'auditPage',
          labelKey: 'Audit Page',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'Document is empty' };
          },
          run: () => runAction('runAudit'),
        },
        {
          id: 'auditDocument',
          labelKey: 'Audit Document',
          kind: 'command',
          group: 'intelligence',
          enabled: (ctx) => {
            if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
            if (ctx.document.nodeCount >= 1) return true;
            return { reason: 'Document is empty' };
          },
          run: () => runAction('runAudit'),
        },
      ],
      run: () => {},
    },
    {
      id: 'scanDebt',
      labelKey: 'menu.object.scanDebt',
      kind: 'command',
      group: 'intelligence',
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
      id: 'suggestNames',
      labelKey: 'menu.object.suggestNames',
      kind: 'command',
      group: 'intelligence',
      enabled: (ctx) => {
        if (ctx.intelligence.scanInProgress) return { reason: 'A scan is already running' };
        if (ctx.selection.count >= 1) return true;
        return { reason: 'Select one or more layers' };
      },
      run: () => runAction('suggestNames'),
    },
    {
      id: 'detectDuplicates',
      labelKey: 'menu.object.detectDuplicates',
      kind: 'command',
      group: 'intelligence',
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
  ];
}
