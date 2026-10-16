/**
 * The element id each panel's container carries.
 *
 * One mapping, two consumers: `Shell.tsx`/`WorkspaceBottomPanels.tsx` render
 * these ids, and the dock's splitter resolution uses them for `aria-controls`
 * (`workspace/dock/dockPanelSizing.ts`). Before this lived here, the dock kept a
 * hand-written subset that omitted the three bottom-strip panels — whose ids do
 * exist — so their splitters announced no controlled element.
 *
 * `aria-controls` must reference an element that exists, so a consumer must
 * only emit it for a panel the current workspace actually renders.
 */

import type { PanelId } from './panelIds';

export const PANEL_ELEMENT_IDS: Record<PanelId, string> = {
  layers: 'editor-layers-panel',
  inspector: 'editor-inspector-panel',
  timeline: 'editor-timeline-panel',
  pagenav: 'editor-pagenav-panel',
  library: 'editor-library-panel',
  codegen: 'editor-codegen-panel',
  logo: 'editor-logo-panel',
  history: 'editor-history-panel',
  emailPreview: 'editor-email-preview-panel',
  emailOutput: 'editor-email-output-panel',
};
