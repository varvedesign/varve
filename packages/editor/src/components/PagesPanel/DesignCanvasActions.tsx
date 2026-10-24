import { IconButton, Menu, type MenuEntry } from '@varve/ui';
import { useId, useRef, useState } from 'react';

interface DesignCanvasActionsProps {
  name: string;
  first: boolean;
  last: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

/** Management commands share one stable target; revealing them never hides the canvas name. */
export function DesignCanvasActions({
  name,
  first,
  last,
  onRename,
  onDuplicate,
  onMove,
  onRemove,
}: DesignCanvasActionsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const openDialog = (action: () => void) => {
    // Native dialogs restore their previous focus. The menu item is about to
    // unmount, so hand ownership to the stable trigger before showModal runs.
    triggerRef.current?.focus({ preventScroll: true });
    action();
  };
  const items: MenuEntry[] = [
    {
      id: 'rename',
      label: 'Rename',
      onAction: () => openDialog(onRename),
      dialog: true,
      focusTransfer: 'dialog',
    },
    { id: 'duplicate', label: 'Duplicate', onAction: onDuplicate },
    { id: 'move-up', label: 'Move up', onAction: () => onMove(-1), disabled: first },
    { id: 'move-down', label: 'Move down', onAction: () => onMove(1), disabled: last },
    { id: 'remove-separator', separator: true },
    {
      id: 'remove',
      label: 'Remove canvas',
      onAction: () => openDialog(onRemove),
      destructive: true,
      dialog: true,
      focusTransfer: 'dialog',
    },
  ];
  return (
    <div className="design-canvas-panel__actions">
      <IconButton
        ref={triggerRef}
        icon="Ellipsis"
        size="icon-xs"
        label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <Menu
          id={menuId}
          label={`Actions for ${name}`}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          items={items}
          size="compact"
        />
      )}
    </div>
  );
}
