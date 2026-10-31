import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorContextValue, setToastHandler } from '../context';
import {
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
} from '../workspace/workspaceStore';
import { getActionRegistry, resetActionRegistryForTesting } from './ActionRegistry';
import { openExternalUrl, openVarveContact } from './openExternalUrl';
import { registerEditorActions } from './registerAll';

// `vi.mock` is hoisted above module-level `let`s, so the flag the factory
// closes over has to be hoisted with it.
const runtime = vi.hoisted(() => ({ isTauri: false }));

vi.mock('@varve/platform', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  isTauriRuntime: () => runtime.isTauri,
}));

function makeEditorMock(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    setInspectorTab: vi.fn(),
    state: { selection: [], pixelGridEnabled: false },
    toggleLeftPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    setPixelGridEnabled: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

describe('registerEditorActions — intelligence commands', () => {
  afterEach(() => {
    resetActionRegistryForTesting();
  });

  it('registers Audit, Scan for Debt, Suggest Names, and Detect Duplicates', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    expect(r.has('runAudit')).toBe(true);
    expect(r.has('scanDebt')).toBe(true);
    expect(r.has('suggestNames')).toBe(true);
    expect(r.has('detectDuplicates')).toBe(true);
  });

  it('keeps the Logo panel toggle routed through its Design workflow', async () => {
    const requestWorkspaceSwitch = vi.fn().mockResolvedValue(true);
    const setPanelVisible = vi.fn();
    const toggleLogoPanel = vi.fn();
    const editor = makeEditorMock({
      state: { workspaceMode: 'print', logoPanelVisible: false } as EditorContextValue['state'],
      requestWorkspaceSwitch,
      setPanelVisible,
      toggleLogoPanel,
    });
    registerEditorActions(editor);

    const handler = getActionRegistry().get('toggleLogoPanel')?.handler;
    await handler?.(undefined);

    expect(requestWorkspaceSwitch).toHaveBeenCalledWith('design');
    expect(setPanelVisible).toHaveBeenCalledWith('logo', true);
    expect(toggleLogoPanel).not.toHaveBeenCalled();
  });

  it('registered intelligence actions dispatch to setInspectorTab when executed', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    r.get('scanDebt')?.handler(undefined);
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'debt');
  });

  it('makes intelligence commands searchable in the action registry', () => {
    const editor = makeEditorMock();
    registerEditorActions(editor);
    const r = getActionRegistry();
    expect(r.search('debt')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'scanDebt' })]),
    );
    expect(r.search('contrast')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'runAudit' })]),
    );
  });

  it('registers searchable commands for every durable inspector workflow', () => {
    registerEditorActions(makeEditorMock());
    const registry = getActionRegistry();

    for (const id of [
      'openInspectorProperties',
      'openAppearancePanel',
      'openAdjustmentsPanel',
      'openPrototypePanel',
      'openFontsPanel',
      'openDocumentPanel',
      'openExportPanel',
      'openInspectPanel',
      'openAuditPanel',
    ]) {
      expect(registry.has(id), id).toBe(true);
    }
    expect(registry.search('retouch')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'openAdjustmentsPanel' })]),
    );
  });

  it('registers real clipping-mask handlers before shortcut stubs', () => {
    const editor = makeEditorMock({
      createClippingMaskFromSelected: vi.fn(),
      releaseClippingMaskFromSelected: vi.fn(),
    });
    registerEditorActions(editor);
    const registry = getActionRegistry();

    registry.get('createClippingMask')?.handler(undefined);
    registry.get('releaseClippingMask')?.handler(undefined);

    expect(editor.createClippingMaskFromSelected).toHaveBeenCalledOnce();
    expect(editor.releaseClippingMaskFromSelected).toHaveBeenCalledOnce();
  });

  it('registers visible non-shortcut menu commands with real handlers', () => {
    const onFindReplace = vi.fn();
    const editor = makeEditorMock();
    registerEditorActions(editor, { onFindReplace });

    const registry = getActionRegistry();
    for (const id of [
      'findReplace',
      'textBold',
      'inspectMode',
      'resetWorkspace',
      'about',
      'viewToolbarTop',
      'viewToolbarBottom',
    ]) {
      expect(registry.has(id), id).toBe(true);
    }

    registry.get('findReplace')?.handler(undefined);
    expect(onFindReplace).toHaveBeenCalledOnce();
  });

  it('registers toolbar placement commands that persist the active workspace preference', () => {
    resetWorkspacePreferenceCache();
    const editor = makeEditorMock({
      state: {
        selection: [],
        pixelGridEnabled: false,
        workspaceMode: 'design',
      } as unknown as EditorContextValue['state'],
    });
    registerEditorActions(editor);
    const registry = getActionRegistry();

    registry.get('viewToolbarTop')?.handler(undefined);
    expect(getWorkspacePreferences().design.toolbarPlacement).toBe('top');

    registry.get('viewToolbarBottom')?.handler(undefined);
    expect(getWorkspacePreferences().design.toolbarPlacement).toBeUndefined();
  });

  it('registers Generative Edit as a searchable object action', () => {
    const editor = makeEditorMock({
      state: {
        selection: [],
        pixelGridEnabled: false,
        document: {},
      } as unknown as EditorContextValue['state'],
      openCafDialog: vi.fn(),
    });
    registerEditorActions(editor);
    const registry = getActionRegistry();

    expect(registry.has('contentAwareFill')).toBe(true);
    expect(registry.search('inpainting')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'contentAwareFill' })]),
    );
  });

  it('keeps panel-window recovery commands searchable and refreshes their callbacks', () => {
    const firstBring = vi.fn();
    const firstReset = vi.fn();
    const editor = makeEditorMock();
    registerEditorActions(editor, {
      onBringAllPanelsToCurrentDisplay: firstBring,
      onResetPanelWindowLayout: firstReset,
    });

    const registry = getActionRegistry();
    registry.get('bringAllPanelsToCurrentDisplay')?.handler(undefined);
    registry.get('resetPanelWindowLayout')?.handler(undefined);
    expect(firstBring).toHaveBeenCalledOnce();
    expect(firstReset).toHaveBeenCalledOnce();
    expect(registry.search('offscreen')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'bringAllPanelsToCurrentDisplay' })]),
    );

    const latestBring = vi.fn();
    const latestReset = vi.fn();
    registerEditorActions(editor, {
      onBringAllPanelsToCurrentDisplay: latestBring,
      onResetPanelWindowLayout: latestReset,
    });
    registry.get('bringAllPanelsToCurrentDisplay')?.handler(undefined);
    registry.get('resetPanelWindowLayout')?.handler(undefined);

    expect(latestBring).toHaveBeenCalledOnce();
    expect(latestReset).toHaveBeenCalledOnce();
  });
});

/**
 * Help > Send Feedback must open the public feedback page in a real browser.
 * Other Help contact items stay on mailto, because they are real addresses.
 * A failed open must never be silent: the toast carries the URL and Copy.
 */
describe('openVarveContact', () => {
  const originalLocation = window.location;
  const originalOpen = window.open;
  const toasts: Array<{
    message: string;
    type?: string;
    action?: { label: string };
  }> = [];

  beforeEach(() => {
    runtime.isTauri = false;
    toasts.length = 0;
    setToastHandler((opts) => {
      toasts.push(opts);
    });
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    // Browsers return null from window.open(..., 'noopener'). That is success.
    window.open = vi.fn().mockReturnValue(null);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    window.open = originalOpen;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    runtime.isTauri = false;
    setToastHandler(null);
  });

  function stubLocation(): { current: string } {
    const href = { current: '' };
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(value: string) {
          href.current = value;
        },
        get href() {
          return href.current;
        },
      },
    });
    return href;
  }

  it('opens the feedback page in a new tab on the web build', () => {
    const href = stubLocation();
    openVarveContact('feedback');
    expect(window.open).toHaveBeenCalledWith(
      'https://varve.studio/feedback',
      '_blank',
      'noopener,noreferrer',
    );
    expect(href.current).toBe('');
    expect(toasts).toHaveLength(0);
  });

  it('hands the feedback https URL to the native opener under Tauri', () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    const href = stubLocation();

    openVarveContact('feedback');

    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://varve.studio/feedback',
    });
    expect(href.current).toBe('');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('navigates to the channel mailto on the web build for real addresses', () => {
    const href = stubLocation();
    openVarveContact('support');
    expect(href.current).toBe('mailto:support@varve.studio?subject=Varve%20support');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('hands a mailto URL to the native opener under Tauri for real addresses', () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    const href = stubLocation();

    openVarveContact('security');

    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'mailto:security@varve.studio?subject=Varve%20security%20report',
    });
    expect(href.current).toBe('');
  });

  it('shows a toast with the URL and a Copy action when the opener fails', async () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockRejectedValue(new Error('no handler'));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };

    expect(() => openVarveContact('feedback')).not.toThrow();
    await vi.waitFor(() => {
      expect(toasts.length).toBe(1);
    });
    expect(toasts[0]?.message).toBe('https://varve.studio/feedback');
    expect(toasts[0]?.type).toBe('warning');
    expect(toasts[0]?.action).toEqual(expect.objectContaining({ label: 'Copy' }));
  });

  it('shows a toast when the web build throws while opening a new tab', async () => {
    window.open = vi.fn().mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(openExternalUrl('https://varve.studio/feedback')).resolves.toBe(false);
    expect(toasts[0]?.message).toBe('https://varve.studio/feedback');
    expect(toasts[0]?.action).toEqual(expect.objectContaining({ label: 'Copy' }));
  });

  it('rejects a foreign https URL without calling the opener', async () => {
    runtime.isTauri = true;
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };

    await expect(openExternalUrl('https://example.com')).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it('rejects a file URL without calling the opener', async () => {
    await expect(openExternalUrl('file:///tmp/secret')).resolves.toBe(false);
    expect(window.open).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });

  it('never puts a body payload on remaining mailto contact URLs', () => {
    const href = stubLocation();
    for (const channel of ['support', 'security', 'privacy'] as const) {
      openVarveContact(channel);
      expect(href.current).toMatch(/^mailto:/);
      expect(href.current).not.toMatch(/body=/);
      expect(href.current.length).toBeLessThan(120);
    }
  });
});
