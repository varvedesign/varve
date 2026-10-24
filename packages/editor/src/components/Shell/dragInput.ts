/** Actual client coordinates, including touch activators and their final lift. */
export function dragClientPoint(event: Event): { x: number; y: number } | null {
  if ('touches' in event) {
    const touch = (event as TouchEvent).touches[0] ?? (event as TouchEvent).changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if ('clientX' in event && 'clientY' in event) {
    return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  }
  return null;
}
