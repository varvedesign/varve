/**
 * Display-text and sound-effect presets.
 *
 * A preset is a patch over ordinary TextNode fields — never outlined glyphs,
 * never a raster, and never a copy of the text. Content, story binding, and
 * geometry are untouched so a preset can be applied to a selected balloon's
 * dialogue or an SFX node without breaking the lettering relationship.
 *
 * Research: docs/research/comic-preset-svg-research-2026-09-20.md. The
 * vocabulary follows published comic lettering practice (heavy contrasting
 * outline for SFX, italic light whisper, wide-tracked electronic voice) and
 * uses no third-party assets.
 */
import { createDefaultEffect, defaultStroke, type Stroke, type TextNode } from '@varve/scene';

export type TextEffectPatch = Partial<
  Pick<
    TextNode,
    | 'fontWeight'
    | 'fontStyle'
    | 'textCase'
    | 'textAlign'
    | 'letterSpacing'
    | 'tracking'
    | 'strokes'
    | 'fill'
    | 'effects'
  >
>;

export interface TextEffectPreset {
  id: string;
  label: string;
  description: string;
  patch: TextEffectPatch;
}

function stroke(r: number, g: number, b: number, weight: number): Stroke {
  return {
    ...defaultStroke(),
    color: { space: 'rgb', r, g, b, a: 255 },
    weight,
  };
}

function sfxShadow() {
  return {
    ...createDefaultEffect('dropShadow', 'sfx-impact-shadow'),
    x: 5,
    y: 7,
    blur: 0,
    spread: 0,
    color: { space: 'rgb' as const, r: 48, g: 16, b: 48, a: 255 },
    opacity: 1,
    visible: true,
  };
}

export const TEXT_EFFECT_PRESETS: readonly TextEffectPreset[] = [
  {
    id: 'sfx-impact',
    label: 'Sound effect',
    description:
      'Uppercase heavy display type with a bright fill, thick dark outline, and offset shadow.',
    patch: {
      fontWeight: 900,
      textCase: 'uppercase',
      textAlign: 'center',
      fill: { space: 'rgb', r: 255, g: 214, b: 10, a: 255 },
      strokes: [stroke(0, 0, 0, 10)],
      effects: [sfxShadow()],
    },
  },
  {
    id: 'outline',
    label: 'Outline',
    description: 'A dark outline that reads over busy artwork.',
    patch: {
      strokes: [stroke(0, 0, 0, 2)],
    },
  },
  {
    id: 'whisper',
    label: 'Whisper',
    description: 'Light italic with wider spacing for quiet dialogue.',
    patch: {
      fontWeight: 300,
      fontStyle: 'italic',
      letterSpacing: 1,
      tracking: 40,
    },
  },
  {
    id: 'electronic',
    label: 'Electronic / radio',
    description: 'Wide-tracked uppercase with a thin outline for broadcast voices.',
    patch: {
      fontWeight: 600,
      textCase: 'uppercase',
      letterSpacing: 2,
      tracking: 80,
      strokes: [stroke(0, 0, 0, 1.5)],
    },
  },
  {
    id: 'display-title',
    label: 'Display title',
    description: 'Tight, heavy, centered display type for chapter titles.',
    patch: {
      fontWeight: 800,
      textAlign: 'center',
      letterSpacing: -0.5,
      tracking: -20,
    },
  },
  {
    id: 'body-reset',
    label: 'Body text',
    description: 'Return lettering to a plain dialogue body with no outline.',
    patch: {
      fontWeight: 400,
      fontStyle: 'normal',
      textCase: 'none',
      textAlign: 'left',
      letterSpacing: 0,
      tracking: 0,
      fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
      strokes: [],
      effects: [],
    },
  },
];

/** Apply a preset to a text node without touching content or geometry. */
export function applyTextEffectPreset(node: TextNode, preset: TextEffectPreset): TextNode {
  return { ...node, ...preset.patch };
}

/** The patch that removes only the outline a preset added. */
export const CLEAR_TEXT_EFFECT_PATCH: TextEffectPatch = { strokes: [] };

export function textEffectPresetById(id: string): TextEffectPreset | undefined {
  return TEXT_EFFECT_PRESETS.find((preset) => preset.id === id);
}
