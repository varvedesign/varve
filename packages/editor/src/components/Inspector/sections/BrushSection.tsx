import { BUILT_IN_BRUSH_PRESETS, defaultBrushPreset, validateBrushPreset } from '@varve/scene';
import { rgbToHex } from '@varve/shared';
import { Select } from '@varve/ui';

const BLEND_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

const SMUDGE_MODE_OPTIONS = [
  { value: 'sampling', label: 'Pure smudge' },
  { value: 'mixing', label: 'Loaded paint' },
  { value: 'fingerpaint', label: 'Fingerpaint' },
] as const;

import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import type { SectionId } from '../sectionRegistry';

interface BrushSectionProps {
  tool: 'paint' | 'eraser' | 'pencil' | 'smudge' | 'pen';
  sectionId?: SectionId;
}

const BUILTIN_OPTIONS = Object.values(BUILT_IN_BRUSH_PRESETS).map((p) => ({
  id: p.id,
  name: p.name,
}));

export function BrushSection({ tool, sectionId }: BrushSectionProps) {
  const { state, setBrushSetting, setForegroundColor } = useEditor();
  const isEraser = tool === 'eraser';
  const isPencil = tool === 'pencil';
  const isPen = tool === 'pen';
  const isSmudge = tool === 'smudge';
  const isVectorInk = isPencil || isPen;
  const { brushSettings } = state;

  const heading = isPencil
    ? 'Pencil'
    : isPen
      ? 'Pen'
      : isEraser
        ? 'Eraser'
        : isSmudge
          ? 'Smudge'
          : 'Brush';
  const foregroundHex = rgbToHex(
    state.foregroundColor[0],
    state.foregroundColor[1],
    state.foregroundColor[2],
  );

  const handlePresetChange = useCallback(
    (presetId: string) => {
      if (!presetId) return;

      const found = validateBrushPreset(
        BUILT_IN_BRUSH_PRESETS[presetId] ?? defaultBrushPreset(presetId, presetId),
      );
      if (!found) return;

      setBrushSetting('presetId', found.id);
      setBrushSetting('radius', found.radius);
      setBrushSetting('opacity', found.opacity);
      setBrushSetting('flow', found.flow);
      setBrushSetting('accumulation', found.accumulation ?? 'buildup');
      setBrushSetting('hardness', found.hardness);
      setBrushSetting('smoothing', found.smoothing);
      setBrushSetting('spacing', found.spacing);
      setBrushSetting('grainId', found.grainId ?? null);
      setBrushSetting('grainScale', found.grainScale);
      setBrushSetting('grainRotation', found.grainRotation);
      setBrushSetting('grainContrast', found.grainContrast);
      setBrushSetting('grainInvert', found.grainInvert);
      setBrushSetting('alphaLock', false);
      setBrushSetting('blendMode', found.blendMode);
    },
    [setBrushSetting],
  );

  // Vector ink tools create editable geometry, so a preset, hardness, spacing,
  // flow or accumulation would have nothing to apply to. What they do have is a
  // width — the same shared Size field every brush uses, read by `createShapeAt`
  // as the committed stroke weight — and, for the Pencil, the stabilizer.
  if (isVectorInk) {
    return (
      <DisclosureSection title={heading} sectionId={sectionId}>
        <NumberField
          label="Size"
          value={brushSettings.radius}
          min={1}
          max={500}
          step={1}
          shiftStep={10}
          unit="px"
          onChange={(v) => setBrushSetting('radius', v)}
        />
        {isPencil && (
          <NumberField
            label="Stabilization"
            value={Math.round(brushSettings.smoothing * 100)}
            min={0}
            max={100}
            step={1}
            shiftStep={10}
            unit="%"
            onChange={(v) => setBrushSetting('smoothing', v / 100)}
          />
        )}
        <p className="insp-panel__empty-hint" role="note">
          {isPen
            ? 'Drag from an anchor to pull its direction handles. Colour comes from the foreground swatch.'
            : 'Draw with the pointer. Size sets the committed stroke width; colour comes from the foreground swatch.'}
        </p>
      </DisclosureSection>
    );
  }

  return (
    <DisclosureSection title={heading} sectionId={sectionId}>
      <div className="insp-field">
        <span className="insp-field__label">Preset</span>
        <div className="insp-field__control">
          <Select
            label="Brush preset"
            value={brushSettings.presetId}
            options={BUILTIN_OPTIONS.map((opt) => ({ value: opt.id, label: opt.name }))}
            onChange={handlePresetChange}
          />
        </div>
      </div>

      <div className="insp-field">
        <span className="insp-field__label">Preview</span>
        <div className="insp-field__control">
          <div
            style={{
              width: Math.min(brushSettings.radius * 2, 64),
              height: Math.min(brushSettings.radius * 2, 64),
              borderRadius: '50%',
              background: isEraser
                ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
                : isSmudge
                  ? 'linear-gradient(135deg, var(--color-accent-primary) 0%, var(--color-text-muted) 100%)'
                  : 'var(--color-text-primary)',
              opacity: brushSettings.opacity,
              margin: '4px auto',
            }}
            role="img"
            aria-label={`Brush preview, ${Math.round(brushSettings.radius)}px`}
          />
        </div>
      </div>

      <NumberField
        label="Size"
        value={brushSettings.radius}
        min={1}
        max={1000}
        step={1}
        shiftStep={10}
        unit="px"
        onChange={(v) => setBrushSetting('radius', v)}
      />

      <NumberField
        label="Opacity"
        value={Math.round(brushSettings.opacity * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('opacity', v / 100)}
      />

      <NumberField
        label="Flow"
        value={Math.round(brushSettings.flow * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('flow', v / 100)}
      />

      {tool === 'paint' && state.workspaceMode !== 'drawing' && (
        <label className="tool-options__field">
          <span>Foreground color</span>
          <input
            type="color"
            aria-label="Foreground color"
            value={foregroundHex}
            onChange={(event) => {
              const hex = event.target.value.replace('#', '');
              const rgb: [number, number, number, number] = [
                Number.parseInt(hex.slice(0, 2), 16),
                Number.parseInt(hex.slice(2, 4), 16),
                Number.parseInt(hex.slice(4, 6), 16),
                255,
              ];
              setForegroundColor(rgb);
            }}
          />
        </label>
      )}

      <Select
        label="Accumulation"
        value={brushSettings.accumulation ?? 'buildup'}
        options={[
          { value: 'buildup', label: 'Buildup' },
          { value: 'stroke-opacity', label: 'Stroke opacity' },
        ]}
        onChange={(value) => setBrushSetting('accumulation', value as 'buildup' | 'stroke-opacity')}
      />

      <NumberField
        label="Hardness"
        value={Math.round(brushSettings.hardness * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('hardness', v / 100)}
      />

      <NumberField
        label="Smoothing"
        value={Math.round(brushSettings.smoothing * 100)}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        unit="%"
        onChange={(v) => setBrushSetting('smoothing', v / 100)}
      />

      {(tool === 'paint' || tool === 'eraser' || tool === 'smudge') && (
        <NumberField
          label="Spacing"
          value={Math.round(brushSettings.spacing * 100)}
          min={1}
          max={100}
          step={1}
          shiftStep={10}
          unit="%"
          onChange={(v) => setBrushSetting('spacing', Math.max(0.01, v / 100))}
        />
      )}

      <div className="insp-field">
        <span className="insp-field__label">Alpha Lock</span>
        <div className="insp-field__control">
          <button
            type="button"
            className={`btn-toggle${brushSettings.alphaLock ? ' btn-toggle--active' : ''}`}
            aria-label="Alpha Lock"
            onClick={() => setBrushSetting('alphaLock', !brushSettings.alphaLock)}
          >
            {brushSettings.alphaLock ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="insp-field">
        <span className="insp-field__label">Blend</span>
        <div className="insp-field__control">
          <Select
            label="Brush blend mode"
            value={brushSettings.blendMode}
            options={BLEND_MODE_OPTIONS}
            onChange={(v) => setBrushSetting('blendMode', v)}
          />
        </div>
      </div>

      {isSmudge && (
        <>
          <div className="insp-field">
            <span className="insp-field__label">Mode</span>
            <div className="insp-field__control">
              <Select
                label="Smudge mode"
                value={brushSettings.smudgeMode}
                options={SMUDGE_MODE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                onChange={(value) =>
                  setBrushSetting('smudgeMode', value as 'sampling' | 'mixing' | 'fingerpaint')
                }
              />
            </div>
          </div>

          <div className="insp-field">
            <span className="insp-field__label">Sample</span>
            <div className="insp-field__control">
              <button
                type="button"
                className={`btn-toggle${brushSettings.smudgeSampleAllLayers ? ' btn-toggle--active' : ''}`}
                aria-label="Sample merged layers"
                aria-pressed={brushSettings.smudgeSampleAllLayers}
                onClick={() =>
                  setBrushSetting('smudgeSampleAllLayers', !brushSettings.smudgeSampleAllLayers)
                }
              >
                {brushSettings.smudgeSampleAllLayers ? 'Merged' : 'Current layer'}
              </button>
            </div>
          </div>

          <p className="insp-field__hint">
            Merged sampling reads visible raster layers and deposits only on the active target.
          </p>

          <NumberField
            label="Strength"
            value={Math.round(brushSettings.smudgeStrength * 100)}
            min={0}
            max={100}
            step={1}
            shiftStep={10}
            unit="%"
            onChange={(v) => setBrushSetting('smudgeStrength', v / 100)}
          />
        </>
      )}
    </DisclosureSection>
  );
}
