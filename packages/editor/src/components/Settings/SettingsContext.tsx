import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { documentAccentController } from '../../appearance/documentAccent';
import { getAutomationMount } from '../../automation/desktopMount';
import {
  refreshInteractivePreviewSettings,
  refreshNavigationSettings,
} from '../../canvas/navigationRuntime';
import {
  updateSettings as applyEditorSettingsPatch,
  DEFAULT_EDITOR_SETTINGS,
  type EditorSettings,
  type EditorSettingsPatch,
  loadSettings as loadEditorSettings,
  saveSettings as saveEditorSettings,
} from '../../settings';
import { applyInterfaceAppearance } from '../../settings/interfaceDensity';
import { registerLayoutPreferenceCommands } from '../../settings/layoutPreferenceCommands';
import {
  LAYOUT_PREFERENCE_REQUEST_EVENT,
  mountLayoutPresentation,
  setLayoutPreference,
  setTabletControlsMirrored,
} from '../../settings/layoutPresentation';
import './layoutPresentation.css';

export type Settings = EditorSettings;

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'backup'
  | 'shortcuts'
  | 'export'
  | 'performance'
  | 'storage'
  | 'nudge'
  | 'input'
  | 'models'
  | 'plugins'
  | 'collab'
  | 'ai'
  | 'privacy'
  | 'automation'
  | 'learning'
  | 'updates'
  | 'about';

export interface SettingsContextValue {
  settings: EditorSettings;
  /**
   * Section-wise patch: `{ render: { renderer: 'webgpu' } }` updates one field
   * and leaves the rest of `render` intact. `Partial<EditorSettings>` would
   * have demanded a complete `RenderSettingsStore` for that same call and, if
   * satisfied, silently replaced every other field in the section.
   */
  updateSettings: (patch: EditorSettingsPatch) => void;
  updateSection: (section: SettingsSection, values: Record<string, unknown>) => void;
  resetSettings: () => void;
}

const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<EditorSettings>(loadEditorSettings);
  const layoutPreferenceRef = useRef(settings.appearance.layoutPreference);
  layoutPreferenceRef.current = settings.appearance.layoutPreference;
  const tabletControlsMirroredRef = useRef(settings.appearance.tabletControlsMirrored);
  tabletControlsMirroredRef.current = settings.appearance.tabletControlsMirrored;

  useEffect(
    () => mountLayoutPresentation(layoutPreferenceRef.current, tabletControlsMirroredRef.current),
    [],
  );
  useEffect(() => registerLayoutPreferenceCommands(), []);

  const layoutPreference = settings.appearance.layoutPreference;
  useEffect(() => setLayoutPreference(layoutPreference), [layoutPreference]);
  const tabletControlsMirrored = settings.appearance.tabletControlsMirrored;
  useEffect(() => setTabletControlsMirrored(tabletControlsMirrored), [tabletControlsMirrored]);

  // Interface appearance (density, UI font size) is root-level DOM state,
  // like the theme. The pre-paint script applies the persisted values before
  // first paint; this effect keeps the DOM contract in sync afterwards — on
  // mount, on every change, and after a settings reset. Both the home and
  // editor shells mount a provider, so every view is covered.
  const uiDensity = settings.appearance.uiDensity;
  const fontSizeUI = settings.appearance.fontSizeUI;
  useEffect(() => {
    applyInterfaceAppearance(uiDensity, fontSizeUI);
  }, [uiDensity, fontSizeUI]);

  // Accent-source preference flows through the same application path as the
  // density/font contract above: one effect covers mount, change, and reset.
  // The home shell mounts a provider too; with no document published the
  // controller simply keeps the fixed accent.
  const accentSource = settings.appearance.accentSource;
  useEffect(() => {
    documentAccentController.setPreference(accentSource);
  }, [accentSource]);

  // Agent access: a person's setting becomes a running (or stopped) connected
  // session. The mount is tiny until automation is first turned on; everything
  // heavy loads then. See automation/desktopMount.ts.
  // Keyed on the three primitives, not the section object: the store rebuilds
  // that object on every settings change, and a restart would drop the clients.
  const automationEnabled = settings.automation.enabled;
  const automationGrants = settings.automation.grants;
  const automationApproval = settings.automation.requireApproval;
  const automationCapture = settings.automation.capture;
  const automationSave = settings.automation.save;
  useEffect(() => {
    void getAutomationMount().apply({
      enabled: automationEnabled,
      grants: automationGrants,
      requireApproval: automationApproval,
      capture: automationCapture,
      save: automationSave,
    });
  }, [automationEnabled, automationGrants, automationApproval, automationCapture, automationSave]);

  // The newest settings, updated synchronously. `updateSection` builds its next
  // state from this rather than from the `settings` it closed over: two changes
  // made before React re-renders (a double click, a key repeat, a driven UI)
  // would otherwise each start from the same stale snapshot and the second
  // would silently discard the first.
  const settingsRef = useRef(settings);
  const persist = useCallback((next: EditorSettings) => {
    settingsRef.current = next;
    setSettings(next);
    saveEditorSettings(next);
  }, []);

  const updateSettings = useCallback(
    (patch: EditorSettingsPatch) => {
      // Delegate to the store's canonical merge so the dialog and every other
      // caller of `updateSettings` produce the same result for the same patch.
      persist(applyEditorSettingsPatch(patch));
      if (
        patch.viewport?.wheelMode !== undefined ||
        patch.viewport?.wheelSensitivity !== undefined ||
        patch.viewport?.wheelInertia !== undefined
      ) {
        refreshNavigationSettings();
      }
      if (patch.render?.interactivePreview !== undefined) {
        refreshInteractivePreviewSettings();
      }
    },
    [persist],
  );

  useEffect(() => {
    const handleLayoutPreferenceRequest = (event: Event) => {
      const preference = (event as CustomEvent<{ preference?: unknown }>).detail?.preference;
      if (preference !== 'auto' && preference !== 'tablet' && preference !== 'desktop') return;
      updateSettings({ appearance: { layoutPreference: preference } });
    };
    window.addEventListener(LAYOUT_PREFERENCE_REQUEST_EVENT, handleLayoutPreferenceRequest);
    return () =>
      window.removeEventListener(LAYOUT_PREFERENCE_REQUEST_EVENT, handleLayoutPreferenceRequest);
  }, [updateSettings]);

  const updateSection = useCallback(
    (section: SettingsSection, values: Record<string, unknown>) => {
      const latest = settingsRef.current;
      const current = (latest as unknown as Record<string, unknown>)[section] as
        | Record<string, unknown>
        | undefined;
      if (!current) return;
      persist({
        ...latest,
        [section]: { ...current, ...values },
      } as EditorSettings);
    },
    [persist],
  );

  const resetSettings = useCallback(() => {
    persist({ ...DEFAULT_EDITOR_SETTINGS });
    refreshNavigationSettings();
    refreshInteractivePreviewSettings();
  }, [persist]);

  return (
    <SettingsCtx.Provider value={{ settings, updateSettings, updateSection, resetSettings }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
