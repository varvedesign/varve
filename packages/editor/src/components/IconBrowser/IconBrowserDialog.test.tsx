// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getIconProviderRegistry, resetIconProviderRegistry } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { loadSettings } from '../../settings';
import { IconBrowserDialog } from './IconBrowserDialog';
import { writeIconRemoteSearchConsent } from './iconRemoteSearch';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

const mockedUseEditor = vi.mocked(useEditor);

function editorMock() {
  const insertIconAsset = vi.fn().mockResolvedValue('n9');
  const replaceIconAsset = vi.fn().mockResolvedValue('n9');
  const detachIconNodes = vi.fn();
  const getIconAsset = vi.fn();
  const getIconAssetForNode = vi.fn();
  mockedUseEditor.mockReturnValue({
    insertIconAsset,
    replaceIconAsset,
    detachIconNodes,
    getIconAsset,
    getIconAssetForNode,
  } as unknown as ReturnType<typeof useEditor>);
  return { insertIconAsset, replaceIconAsset };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetIconProviderRegistry();
});

beforeEach(() => {
  localStorage.clear();
  // Deterministic provider (no network) + hard network ban: unit tests must
  // never hit the live Iconify API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network disabled in icon tests');
    }),
  );
  const fakeProvider = {
    id: 'test',
    name: 'Test Provider',
    kind: 'public-api' as const,
    enabled: true,
    requiresNetwork: true,
    capabilities: ['search', 'fetch-svg'] as const,
    search: vi.fn(async () => ({ items: [], total: 0, start: 0, exhausted: true })),
    getSvg: vi.fn(async () => null),
  };
  getIconProviderRegistry().register(fakeProvider);
});

describe('IconBrowserDialog', () => {
  it('makes no collection-list request before consent', async () => {
    editorMock();
    const fetchMock = vi.mocked(globalThis.fetch);
    const getPacks = vi.spyOn(getIconProviderRegistry(), 'getPacks');
    render(<IconBrowserDialog open onClose={vi.fn()} />);
    expect(await screen.findByText('Search online via Iconify?')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(getPacks).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the consent card after Not now and offers a later opt-in when a search has no local match', async () => {
    editorMock();
    const fetchMock = vi.mocked(globalThis.fetch);
    render(<IconBrowserDialog open onClose={vi.fn()} />);
    expect(await screen.findByText('Search online via Iconify?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Search online via Iconify?')).toBeNull();
    expect(loadSettings().icons.remoteSearch).toBe('denied');

    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    expect(await screen.findByText('No icons match your search.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Search online via Iconify' }));
    expect(loadSettings().icons.remoteSearch).toBe('granted');
    expect(screen.queryByText('Search online via Iconify?')).toBeNull();
  });

  it('renders the browser, searches local icons without asking the network, and does not insert without a selection', async () => {
    const { insertIconAsset } = editorMock();
    const onClose = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    render(<IconBrowserDialog open onClose={onClose} />);

    expect(await screen.findByText('Search online via Iconify?')).toBeTruthy();
    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    expect(await screen.findByText('No icons match your search.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(insertIconAsset).not.toHaveBeenCalled();
  });

  it('shows an actionable error state when the icon service is unreachable', async () => {
    resetIconProviderRegistry();
    writeIconRemoteSearchConsent('granted');
    editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);
    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    // ensureIconProviders() bootstraps the built-in provider, so an empty
    // registry can never silently return zero results — the failure must be
    // surfaced as an actionable network error.
    expect(
      (await screen.findAllByText(/could not reach the icon service/i, {}, { timeout: 15000 }))
        .length,
    ).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  }, 20000);

  it('closes on dialog dismiss', async () => {
    editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close dialog'));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
