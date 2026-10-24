import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { focusLayerSearchOnFind, LayerFilterBar } from './LayerFilterBar';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';

describe('LayerFilterBar — Filter menu and tokens', () => {
  it('offers every dimension from one Filter menu instead of a chip wall', () => {
    render(
      <LayerFilterBar filter={DEFAULT_FILTER} onChange={vi.fn()} matchCount={3} totalCount={12} />,
    );
    const trigger = screen.getByRole('button', { name: 'Filter options' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).not.toHaveAttribute('aria-controls');
    fireEvent.click(trigger);

    // The floating layer is measured before it is shown, so jsdom reports it
    // hidden and names nothing inside it; read the attributes directly.
    const menu = screen.getByRole('menu', { hidden: true });
    expect(menu).toHaveAttribute('aria-label', 'Filter layers');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(
      screen
        .getAllByRole('menuitem', { hidden: true })
        .map((item) => item.querySelector('.varve-menu__item-label')?.textContent),
    ).toEqual(['Type', 'Attribute', 'Blend mode', 'Color tag']);
    expect(document.querySelectorAll('.layers-filter-bar__chip')).toHaveLength(0);
  });

  it('names each active constraint as a token and removes only that one', () => {
    const filter: LayerFilterSpec = {
      ...DEFAULT_FILTER,
      kinds: ['text'],
      attributes: { locked: false },
    };
    const onChange = vi.fn();
    render(<LayerFilterBar filter={filter} onChange={onChange} matchCount={3} totalCount={12} />);

    expect(screen.getByRole('button', { name: 'Filter options, 2 active' })).toBeInTheDocument();
    const tokens = screen.getByRole('list', { name: 'Active filters' });
    expect(tokens).toHaveTextContent('Text');
    expect(tokens).toHaveTextContent('Unlocked');

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Unlocked' }));
    expect(onChange).toHaveBeenCalledWith({ ...filter, attributes: {} });
  });
});

describe('LayerFilterBar — keyboard', () => {
  function renderBar(filter: LayerFilterSpec) {
    const onChange = vi.fn();
    const onStepMatch = vi.fn();
    const onFocusResults = vi.fn();
    render(
      <LayerFilterBar
        filter={filter}
        onChange={onChange}
        matchCount={2}
        totalCount={12}
        onStepMatch={onStepMatch}
        onFocusResults={onFocusResults}
      />,
    );
    return {
      field: screen.getByRole('searchbox', { name: 'Filter layers by name' }),
      onChange,
      onStepMatch,
      onFocusResults,
    };
  }

  it('Escape clears the text first and moves into the results next', () => {
    const typed = renderBar({ ...DEFAULT_FILTER, search: 'card', kinds: ['frame'] });
    fireEvent.keyDown(typed.field, { key: 'Escape' });
    expect(typed.onChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTER,
      search: '',
      kinds: ['frame'],
    });
    expect(typed.onFocusResults).not.toHaveBeenCalled();
    cleanup();

    const empty = renderBar(DEFAULT_FILTER);
    fireEvent.keyDown(empty.field, { key: 'Escape' });
    expect(empty.onFocusResults).toHaveBeenCalledTimes(1);
  });

  it('Enter and Shift+Enter step through matches; ArrowDown enters the tree', () => {
    const bar = renderBar({ ...DEFAULT_FILTER, search: 'card' });
    fireEvent.keyDown(bar.field, { key: 'Enter' });
    fireEvent.keyDown(bar.field, { key: 'Enter', shiftKey: true });
    expect(bar.onStepMatch.mock.calls).toEqual([[1], [-1]]);
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(bar.onStepMatch).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(bar.field, { key: 'ArrowDown' });
    expect(bar.onFocusResults).toHaveBeenCalledTimes(1);
  });

  it('Ctrl/Cmd+F focuses and selects the layer search', () => {
    const field = document.createElement('input');
    field.value = 'card';
    document.body.append(field);
    const event = {
      key: 'f',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.KeyboardEvent;
    focusLayerSearchOnFind(event, field);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(4);
    expect(event.stopPropagation).toHaveBeenCalled();
    field.remove();
  });
});

describe('LayerFilterBar — workspace presets', () => {
  it('renders only the configured quick filters, as toggle buttons', () => {
    render(
      <LayerFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        matchCount={3}
        totalCount={12}
        quickFilters={['animated']}
      />,
    );

    const preset = screen.getByRole('button', { name: 'Animated' });
    expect(preset).toHaveAttribute('aria-pressed', 'false');
    // No other workspace preset leaks in.
    expect(screen.queryByRole('button', { name: 'Mobile hidden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Threaded text' })).toBeNull();
  });

  it('maps each preset onto its attribute dimension and back off', () => {
    let filter: LayerFilterSpec = DEFAULT_FILTER;
    const onChange = vi.fn((next: LayerFilterSpec) => {
      filter = next;
    });
    const { rerender } = render(
      <LayerFilterBar
        filter={filter}
        onChange={onChange}
        matchCount={3}
        totalCount={12}
        quickFilters={['mobile-hidden', 'masks']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mobile hidden' }));
    expect(filter.attributes.mobileHidden).toBe(true);
    rerender(
      <LayerFilterBar
        filter={filter}
        onChange={onChange}
        matchCount={3}
        totalCount={12}
        quickFilters={['mobile-hidden', 'masks']}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mobile hidden' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mobile hidden' }));
    expect(filter.attributes.mobileHidden).toBeUndefined();
  });

  it('offers Select matches only while filtering with at least one match', () => {
    const onSelectMatches = vi.fn();
    const { rerender } = render(
      <LayerFilterBar
        filter={DEFAULT_FILTER}
        onChange={vi.fn()}
        matchCount={12}
        totalCount={12}
        onSelectMatches={onSelectMatches}
      />,
    );
    // No filter: nothing to select "matches" of.
    expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();

    const filtered = { ...DEFAULT_FILTER, search: 'button' };
    rerender(
      <LayerFilterBar
        filter={filtered}
        onChange={vi.fn()}
        matchCount={4}
        totalCount={12}
        onSelectMatches={onSelectMatches}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select matches' }));
    expect(onSelectMatches).toHaveBeenCalledTimes(1);
  });

  it('has no Select matches action when the caller does not provide one', () => {
    render(
      <LayerFilterBar
        filter={{ ...DEFAULT_FILTER, search: 'x' }}
        onChange={vi.fn()}
        matchCount={1}
        totalCount={12}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();
  });
});
