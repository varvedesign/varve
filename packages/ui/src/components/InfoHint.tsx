/**
 * InfoHint — an explanation one activation away from the control it explains.
 *
 * Long help copy does not belong in a dense panel's resting layout: the
 * 2026-10-21 shell audit (F-24) found six always-visible paragraphs of 73–253
 * characters in the canvas Inspector alone. InfoHint keeps the copy next to
 * its control behind an (i) button. Click, Enter or Space opens a non-modal
 * popover; Escape or a click outside closes it.
 *
 * A popover rather than a tooltip on purpose: the text must be reachable by
 * keyboard and touch and must stay put while it is read (WCAG 1.4.13), which
 * hover tooltips do not guarantee.
 */
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';
import { Popover, type PopoverProps } from './Popover';

export interface InfoHintProps {
  /** What the hint explains. Names the button ("About <topic>") and the panel. */
  topic: string;
  /** The explanation. Plain reading text; keep it to a few sentences. */
  children: ReactNode;
  placement?: PopoverProps['placement'];
  className?: string;
}

export function InfoHint({ topic, children, placement = 'bottom', className }: InfoHintProps) {
  const name = `About ${topic}`;
  return (
    <Popover
      placement={placement}
      label={name}
      popover={<div className="varve-info-hint__body">{children}</div>}
    >
      <IconButton
        icon="Info"
        label={name}
        variant="ghost"
        size="icon-xs"
        className={className ? `varve-info-hint ${className}` : 'varve-info-hint'}
      />
    </Popover>
  );
}
