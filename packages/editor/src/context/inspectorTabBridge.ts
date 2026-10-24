import type { InspectorTab, InspectorTabOptions, IntelligenceTab } from './types';

interface InspectorTabRequest extends InspectorTabOptions {
  tab: InspectorTab;
  subTab?: IntelligenceTab;
}

let inspectorTabHandler: ((request: InspectorTabRequest) => void) | null = null;

export function setInspectorTabHandler(
  handler: ((request: InspectorTabRequest) => void) | null,
): void {
  inspectorTabHandler = handler;
}

export function requestInspectorTab(
  tab: InspectorTab,
  subTab?: IntelligenceTab,
  options?: InspectorTabOptions,
): void {
  inspectorTabHandler?.({ tab, subTab, ...options });
}
