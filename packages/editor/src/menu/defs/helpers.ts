import { SHORTCUT_DEFS } from '../../shortcuts/ShortcutManager';
import type { ShortcutBinding } from '../../shortcuts/types';
import type { Accelerator, Capability, MenuContext } from '../types';

export function hasCapability(ctx: MenuContext, cap: Capability): boolean {
  return ctx.platform.capabilities.has(cap);
}

export const a = (
  key: string,
  ctrl?: boolean,
  shift?: boolean,
  alt?: boolean,
  meta?: boolean,
): Accelerator => ({ key, ctrl, shift, alt, meta });

/**
 * Resolve a menu accelerator from the live shortcut registry instead of a
 * hand-maintained copy (workspace mode keys follow switcher order on
 * Ctrl+Shift+1..6; the Logo and Code actions use +7 and +8).
 */
export function acceleratorFor(shortcutId: keyof typeof SHORTCUT_DEFS): Accelerator {
  const binding = (SHORTCUT_DEFS[shortcutId]?.binding ?? { key: '' }) as ShortcutBinding;
  return a(binding.key, binding.ctrl, binding.shift, binding.alt);
}

export function enabledWithSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count > 0) return true;
  return { reason: 'Select a layer first' };
}

export function enabledWithNudge(ctx: MenuContext): true | { reason: string } {
  if (ctx.nudge.canNudge) return true;
  return { reason: ctx.nudge.reason ?? 'Selected layers cannot be moved' };
}

export function enabledWithMultiSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count >= 2) return true;
  return { reason: 'Select 2 or more layers' };
}

export function enabledWithTripleSelection(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.count >= 3) return true;
  return { reason: 'Select at least three layers to distribute.' };
}

export function enabledWithPanelJoin(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.semanticPanelCount >= 2) return true;
  return { reason: 'Select 2 or more comic panels' };
}

export function enabledWithFramePanels(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.selectedFramePanelChildren > 0) return true;
  return { reason: 'Select a frame that contains panels' };
}

export function enabledWithSingleGroup(ctx: MenuContext): true | { reason: string } {
  if (ctx.selection.isSingle && ctx.selection.hasGroup) return true;
  return { reason: 'Select a group to ungroup' };
}
