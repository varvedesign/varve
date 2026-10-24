/**
 * Strata `<Icon>` — the single SVG-icon primitive (Strata plan §4.4).
 *
 * Built on Lucide. Enforces the accessible-name contract:
 *   - pass `label` for a meaningful icon -> role="img" + aria-label
 *   - omit `label` for a decorative icon next to visible text -> aria-hidden
 * Zero emoji anywhere; this is the only graphics primitive for UI affordances.
 *
 * Research basis: ARIA APG "icon button" / "decorative image" guidance; SVG-AAM.
 */

import { icons, type LucideIcon } from 'lucide-react';
import { forwardRef, type SVGProps } from 'react';
import { type IconSizeInput, resolveIconSize } from './iconSize';

/** Every Lucide icon name (PascalCase). Compile-time-checked `name` prop. */
export type IconName = keyof typeof icons;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Lucide icon name, e.g. "Square", "MousePointer2", "Pen". */
  name: IconName;
  /**
   * Accessible name. If provided the icon is exposed as `role="img"` with an
   * `aria-label`. If omitted the icon is marked `aria-hidden` (decorative) and
   * MUST be accompanied by a visible text label in the surrounding UI.
   */
  label?: string;
  /**
   * An icon size token (`xs` 12, `sm` 16, `md` 20, `lg` 24, `xl` 32). A raw number or
   * em/rem/px string snaps to the nearest token (see `iconSize.ts`); the default is
   * `sm`. Stroke uses currentColor.
   */
  size?: IconSizeInput;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, label, size: sizeInput, ...rest },
  ref,
) {
  const size = resolveIconSize(sizeInput);
  const Cmp = icons[name] as LucideIcon | undefined;
  if (!Cmp) {
    console.warn(`[Icon] Unknown icon: "${name}"`);
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        role="img"
        aria-label={label}
        style={{ display: 'inline-flex', width: size, height: size }}
      />
    );
  }
  if (label) {
    return <Cmp ref={ref} role="img" aria-label={label} size={size} {...rest} />;
  }
  return <Cmp ref={ref} aria-hidden size={size} focusable={false} {...rest} />;
});
