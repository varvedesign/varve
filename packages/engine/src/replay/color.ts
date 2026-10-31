import { managedColorToRgba } from '@varve/shared';
import type { EngineColor } from '../types';
export function rgba(
  c: EngineColor | readonly [number, number, number, number],
  opacityOverride?: number,
): string {
  if (c == null) {
    return 'rgba(0, 0, 0, 0)';
  }
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    const alpha = opacityOverride !== undefined ? opacityOverride : arr[3] / 255;
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${alpha})`;
  }
  const [r, g, b, a] = managedColorToRgba(c as EngineColor);
  const alpha = opacityOverride !== undefined ? opacityOverride : a / 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
