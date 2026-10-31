import { describe, expect, it } from 'vitest';
import { shouldAutoOpenToolOptions } from './ToolOptionsPopover';

describe('shouldAutoOpenToolOptions', () => {
  it('opens brush and marquee options on tool change', () => {
    expect(shouldAutoOpenToolOptions('paint')).toBe(true);
    expect(shouldAutoOpenToolOptions('marquee')).toBe(true);
    expect(shouldAutoOpenToolOptions('liquify')).toBe(true);
  });

  it('does not auto-open the New text panel so the first canvas drag creates a box', () => {
    expect(shouldAutoOpenToolOptions('text')).toBe(false);
    expect(shouldAutoOpenToolOptions('select')).toBe(false);
  });
});
