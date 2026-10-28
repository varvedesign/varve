import type { MenuItemDef } from '../types';
import { a, acceleratorFor, enabledWithMultiSelection, enabledWithSelection } from './helpers';
import { getObjectIntelligenceMenuItems } from './objectIntelligence';
import { getPathSubmenuEntry } from './path';

export function getObjectMenu(runAction: (id: string) => void): MenuItemDef[] {
  return [
    {
      id: 'group',
      labelKey: 'menu.object.group',
      accelerator: a('g', true),
      kind: 'command',
      group: 'grouping',
      enabled: (ctx) => {
        if (ctx.selection.canGroup) return true;
        return { reason: 'Requires 2+ selected nodes' };
      },
      run: () => runAction('group'),
    },
    {
      id: 'ungroup',
      labelKey: 'menu.object.ungroup',
      accelerator: a('g', true, true),
      kind: 'command',
      group: 'grouping',
      enabled: (ctx) => {
        if (ctx.selection.canUngroup) return true;
        return { reason: 'Select a group to ungroup' };
      },
      run: () => runAction('ungroup'),
    },
    {
      id: 'flipH',
      labelKey: 'menu.object.flipH',
      accelerator: a('h', true),
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('flipH'),
    },
    {
      id: 'flipV',
      labelKey: 'menu.object.flipV',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('flipV'),
    },
    {
      id: 'repeatTransform',
      labelKey: 'menu.object.repeatTransform',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('repeatTransform'),
    },
    {
      id: 'resizeImage',
      labelKey: 'menu.object.resizeImage',
      kind: 'command',
      group: 'transform',
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer first' };
      },
      run: () => runAction('resizeImage'),
    },
    {
      id: 'bakeWarp',
      labelKey: 'menu.object.bakeWarp',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('bakeWarp'),
    },
    {
      id: 'fitSelectionToPlane',
      labelKey: 'menu.object.fitSelectionToPlane',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('fitSelectionToPlane'),
    },
    {
      id: 'unprojectSelectionFromPlane',
      labelKey: 'menu.object.unprojectSelectionFromPlane',
      kind: 'command',
      group: 'transform',
      enabled: enabledWithSelection,
      run: () => runAction('unprojectSelectionFromPlane'),
    },
    {
      id: 'createIsometricGridArtwork',
      labelKey: 'menu.object.createIsometricGridArtwork',
      kind: 'command',
      group: 'transform',
      run: () => runAction('createIsometricGridArtwork'),
    },
    {
      id: 'openEffectStudio',
      labelKey: 'menu.object.openEffectStudio',
      accelerator: acceleratorFor('openAppearancePanel'),
      kind: 'command',
      group: 'adjustment',
      run: () => runAction('openAppearancePanel'),
    },
    {
      id: 'newAdjustmentLayer',
      labelKey: 'menu.object.newAdjustmentLayer',
      accelerator: a('a', true, true),
      kind: 'command',
      group: 'adjustment',
      workspaces: ['design', 'print', 'image'],
      run: () => runAction('newAdjustmentLayer'),
    },
    {
      id: 'createClippingMask',
      labelKey: 'menu.object.createClippingMask',
      accelerator: a('7', true),
      kind: 'command',
      group: 'mask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('createClippingMask'),
    },
    {
      id: 'releaseClippingMask',
      labelKey: 'menu.object.releaseClippingMask',
      accelerator: a('7', true, true),
      kind: 'command',
      group: 'mask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('releaseClippingMask'),
    },
    {
      id: 'batchBgRemove',
      labelKey: 'menu.object.batchBgRemove',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('batchBgRemove'),
    },
    {
      id: 'imageTrace',
      labelKey: 'menu.object.imageTrace',
      accelerator: a('t', true, true, true),
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('imageTrace'),
    },
    {
      id: 'attachTextToPath',
      labelKey: 'menu.object.attachTextToPath',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'print', 'drawing'],
      enabled: (ctx) => {
        if (ctx.selection.count === 2 && ctx.selection.hasText && ctx.selection.hasVector)
          return true;
        return { reason: 'Select exactly one text layer and one shape' };
      },
      run: () => runAction('attachTextToPath'),
    },
    {
      id: 'detachTextFromPath',
      labelKey: 'menu.object.detachTextFromPath',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'print', 'drawing'],
      enabled: (ctx) => {
        if (ctx.selection.isSingle && ctx.selection.hasText) return true;
        return { reason: 'Select one text layer that is on a path' };
      },
      run: () => runAction('detachTextFromPath'),
    },
    {
      id: 'toolCrop',
      labelKey: 'menu.object.cropImage',
      accelerator: a('c', true, true),
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'print', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('toolCrop'),
    },
    {
      id: 'toolPerspective',
      labelKey: 'menu.object.perspectiveImage',
      accelerator: acceleratorFor('toolPerspective'),
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'print', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('toolPerspective'),
    },
    {
      id: 'extractPalette',
      labelKey: 'menu.object.extractPalette',
      kind: 'command',
      group: 'image',
      workspaces: ['design', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasImage) return true;
        return { reason: 'Select an image layer' };
      },
      run: () => runAction('extractPalette'),
    },
    {
      id: 'applyMockup',
      labelKey: 'menu.object.applyMockup',
      kind: 'command',
      group: 'mockup',
      enabled: enabledWithSelection,
      run: () => runAction('applyMockup'),
    },
    {
      id: 'createMockupTemplate',
      labelKey: 'menu.object.createMockupTemplate',
      kind: 'command',
      group: 'mockup',
      enabled: enabledWithSelection,
      run: () => runAction('createMockupTemplate'),
    },
    {
      id: 'addAlphaMask',
      labelKey: 'menu.object.addAlphaMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addAlphaMask'),
    },
    {
      id: 'createMaskFromSelection',
      labelKey: 'menu.object.createMaskFromSelection',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('createMaskFromSelection'),
    },
    {
      id: 'loadMaskAsSelection',
      labelKey: 'menu.object.loadMaskAsSelection',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('loadMaskAsSelection'),
    },
    {
      id: 'addClipMask',
      labelKey: 'menu.object.addClipMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addClipMask'),
    },
    {
      id: 'addLuminanceMask',
      labelKey: 'menu.object.addLuminanceMask',
      kind: 'command',
      group: 'addMask',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('addLuminanceMask'),
    },
    {
      id: 'removeMask',
      labelKey: 'menu.object.removeMask',
      kind: 'command',
      group: 'maskOps',
      destructive: true,
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('removeMask'),
    },
    {
      id: 'toggleMask',
      labelKey: 'menu.object.toggleMask',
      kind: 'command',
      group: 'maskOps',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('toggleMask'),
    },
    {
      id: 'invertMask',
      labelKey: 'menu.object.invertMask',
      kind: 'command',
      group: 'maskOps',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: (ctx) => {
        if (ctx.selection.hasMask) return true;
        return { reason: 'Selection has no mask' };
      },
      run: () => runAction('invertMask'),
    },
    {
      id: 'flattenSelection',
      labelKey: 'menu.object.flattenSelection',
      accelerator: a('e', true, true),
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('flattenSelection'),
    },
    {
      id: 'rasterizeSelection',
      labelKey: 'menu.object.rasterize',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('rasterizeSelection'),
    },
    {
      id: 'mergeSelected',
      labelKey: 'menu.object.mergeSelected',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing', 'image'],
      enabled: enabledWithSelection,
      run: () => runAction('mergeSelected'),
    },
    {
      id: 'addClearSpaceGuides',
      labelKey: 'menu.object.addClearSpaceGuides',
      kind: 'command',
      group: 'flatten',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithSelection,
      run: () => runAction('addClearSpaceGuides'),
    },
    {
      id: 'booleanUnion',
      labelKey: 'menu.object.booleanUnion',
      accelerator: a('u', true, true),
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanUnion'),
    },
    {
      id: 'booleanSubtract',
      labelKey: 'menu.object.booleanSubtract',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanSubtract'),
    },
    {
      id: 'booleanIntersect',
      labelKey: 'menu.object.booleanIntersect',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanIntersect'),
    },
    {
      id: 'booleanExclude',
      labelKey: 'menu.object.booleanExclude',
      kind: 'command',
      group: 'boolean',
      workspaces: ['design', 'print', 'drawing'],
      enabled: enabledWithMultiSelection,
      run: () => runAction('booleanExclude'),
    },
    ...getPathSubmenuEntry(runAction),
    ...getObjectIntelligenceMenuItems(runAction),
  ];
}
