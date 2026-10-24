import type { MenuEntry } from '@varve/ui';
import { describe, expect, it, vi } from 'vitest';
import { activeFilterTokens, buildLayerFilterMenu } from './layerFilterMenu';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';

function submenu(entries: MenuEntry[], label: string): MenuEntry[] {
  const entry = entries.find((e) => 'label' in e && e.label === label);
  if (!entry || !('submenu' in entry)) throw new Error(`no submenu ${label}`);
  return [...entry.submenu];
}

function change(onChange: ReturnType<typeof vi.fn>, index: number): LayerFilterSpec {
  const call = onChange.mock.calls[index];
  if (!call) throw new Error(`onChange call ${index} missing`);
  return call[0] as LayerFilterSpec;
}

function toggle(entries: MenuEntry[], label: string) {
  const entry = entries.find((e) => 'label' in e && e.label === label);
  if (!entry || !('onToggle' in entry)) throw new Error(`no toggle ${label}`);
  entry.onToggle();
}

describe('buildLayerFilterMenu', () => {
  it('toggles a type and reports how many are active', () => {
    const onChange = vi.fn();
    const menu = buildLayerFilterMenu(DEFAULT_FILTER, onChange);
    toggle(submenu(menu, 'Type'), 'Text');
    const next = change(onChange, 0);
    expect(next.kinds).toEqual(['text']);
    const typeEntry = buildLayerFilterMenu(next, vi.fn()).find(
      (e) => 'label' in e && e.label === 'Type',
    );
    expect(typeEntry && 'badge' in typeEntry ? typeEntry.badge : undefined).toBe('1');
  });

  it('keeps an attribute to one polarity: Hidden replaces Visible', () => {
    const onChange = vi.fn();
    const visible: LayerFilterSpec = { ...DEFAULT_FILTER, attributes: { visible: true } };
    toggle(submenu(buildLayerFilterMenu(visible, onChange), 'Attribute'), 'Hidden');
    expect(change(onChange, 0).attributes).toEqual({
      visible: false,
    });
    toggle(submenu(buildLayerFilterMenu(visible, onChange), 'Attribute'), 'Visible');
    expect(change(onChange, 1).attributes).toEqual({});
  });

  it('chooses one color tag, including untagged', () => {
    const onChange = vi.fn();
    toggle(submenu(buildLayerFilterMenu(DEFAULT_FILTER, onChange), 'Color tag'), 'No color tag');
    expect(change(onChange, 0).attributes.layerColor).toBeNull();
  });
});

describe('activeFilterTokens', () => {
  it('names every active constraint and removes only its own', () => {
    const filter: LayerFilterSpec = {
      search: 'card',
      kinds: ['text'],
      attributes: { locked: false, layerColor: 'red', mobileHidden: true },
      blendModes: ['multiply'],
    };
    const tokens = activeFilterTokens(filter);
    expect(tokens.map((t) => t.label)).toEqual([
      'Text',
      'Unlocked',
      'Hidden on mobile',
      'Multiply',
      'Red tag',
    ]);
    const withoutLocked = tokens.find((t) => t.label === 'Unlocked')?.remove(filter);
    expect(withoutLocked).toEqual({
      ...filter,
      attributes: { layerColor: 'red', mobileHidden: true },
    });
  });

  it('has no tokens for a plain name search', () => {
    expect(activeFilterTokens({ ...DEFAULT_FILTER, search: 'card' })).toEqual([]);
  });
});
