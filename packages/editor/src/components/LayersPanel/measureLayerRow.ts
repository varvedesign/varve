import { measureElement, type Virtualizer } from '@tanstack/react-virtual';

/** Home hides the mounted editor; a zero layout box is not a new row height. */
export function measureLayerRow<TScrollElement extends Element, TItemElement extends Element>(
  element: TItemElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScrollElement, TItemElement>,
): number {
  const height = measureElement(element, entry, instance);
  if (height > 0) return height;

  // Retain measured density/wrapped-row geometry by node identity. Collapsing
  // hidden rows would shrink the spacer and irreversibly clamp its scrollTop.
  const index = instance.indexFromElement(element);
  const key = instance.options.getItemKey(index);
  const cached = instance.itemSizeCache.get(key);
  return cached !== undefined && cached > 0 ? cached : instance.options.estimateSize(index);
}
