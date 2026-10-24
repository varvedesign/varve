import { Button, Icon, NumberInput, Popover, SwitchField, ToggleButton, Tooltip } from '@varve/ui';
import { useId } from 'react';
import { useEditor } from '../../context';
import { formatShortcut, getEffectiveBinding } from '../../shortcuts/ShortcutManager';

/** Frequent toggles stay in reach; view tuning shares one labelled disclosure. */
export function StatusViewControls() {
  const {
    state,
    setPixelGridEnabled,
    setSnapEnabled,
    setSnapGrid,
    setRulerMode,
    setGridOverlayMode,
    clearAllGuides,
  } = useEditor();
  const gridFieldId = useId();
  const showGridSpacing = state.snapEnabled || state.pixelGridEnabled;
  const snapLabel = state.snapEnabled ? 'Disable snapping' : 'Enable snapping';

  return (
    <span className="editor-status__view-group">
      <Tooltip
        label="Toggle pixel grid"
        shortcut={formatShortcut(getEffectiveBinding('togglePixelGrid'))}
      >
        <ToggleButton
          size="sm"
          pressed={state.pixelGridEnabled}
          onPressedChange={setPixelGridEnabled}
          label="Toggle pixel grid"
          className="editor-status__toggle"
        >
          <Icon name="Grid3x3" size={12} />
        </ToggleButton>
      </Tooltip>
      <Tooltip label={snapLabel} shortcut={formatShortcut(getEffectiveBinding('toggleSnap'))}>
        <ToggleButton
          size="sm"
          pressed={state.snapEnabled}
          onPressedChange={setSnapEnabled}
          label={snapLabel}
          className="editor-status__toggle"
        >
          <Icon name="Magnet" size={12} />
        </ToggleButton>
      </Tooltip>
      <Popover
        label="View options"
        placement="top"
        popover={
          <div className="editor-status-view-options">
            <h3 className="editor-status-view-options__title">View options</h3>
            {showGridSpacing && (
              <div className="editor-status-view-options__grid">
                <label htmlFor={gridFieldId}>Grid spacing (px)</label>
                <NumberInput
                  id={gridFieldId}
                  value={state.snapGrid}
                  min={1}
                  max={256}
                  step={1}
                  onChange={setSnapGrid}
                />
              </div>
            )}
            <SwitchField
              label="Artboard ruler origin"
              checked={state.rulerMode === 'artboard'}
              onChange={(event) =>
                setRulerMode(event.currentTarget.checked ? 'artboard' : 'global')
              }
            />
            <SwitchField
              label="Baseline grid"
              checked={state.gridOverlayMode === 'baseline'}
              onChange={(event) =>
                setGridOverlayMode(event.currentTarget.checked ? 'baseline' : 'none')
              }
            />
            {(state.document.guides?.length ?? 0) > 0 && (
              <Button variant="secondary" size="sm" onClick={clearAllGuides}>
                Clear all guides
              </Button>
            )}
          </div>
        }
      >
        <Button
          variant="ghost"
          size="xs"
          aria-label="View options"
          className="editor-status__view-options-trigger"
        >
          View
          <Icon name="ChevronUp" size={12} />
        </Button>
      </Popover>
    </span>
  );
}
