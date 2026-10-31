/**
 * Display-text and sound-effect presets.
 *
 * A preset is a patch over ordinary TextNode fields — never outlined glyphs,
 * never a raster, and never a copy of the text. Content, story binding, and
 * geometry are untouched so a preset can be applied to a selected balloon's
 * dialogue or an SFX node without breaking the lettering relationship.
 *
 * Research basis: docs/research/comic-preset-svg-research-2026-09-20.md. The
 * vocabulary follows published comic lettering practice (heavy contrasting
 * outline for SFX, italic light whisper, wide-tracked electronic voice) and
 * uses no third-party assets.
 */
import {
  cloneStrokesWithFreshIds,
  createDefaultEffect,
  defaultStroke,
  type Effect,
  type Fill,
  type ManagedColor,
  type Stroke,
  type TextEffectState,
  type TextNode,
} from '@varve/scene';

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

export const SFX_IMPACT_SHADOW_ID = 'sfx-impact-shadow';

type DropShadowEffect = Extract<Effect, { type: 'dropShadow' }>;

function stroke(r: number, g: number, b: number, weight: number): Stroke {
  return {
    ...defaultStroke(),
    color: { space: 'rgb', r, g, b, a: 255 },
    weight,
  };
}

function sfxShadow(): DropShadowEffect {
  const base = createDefaultEffect('dropShadow', SFX_IMPACT_SHADOW_ID);
  if (base.type !== 'dropShadow') {
    throw new Error('Sound effect shadow must be a drop shadow.');
  }
  return {
    ...base,
    x: 5,
    y: 7,
    blur: 0,
    spread: 0,
    color: { space: 'rgb' as const, r: 48, g: 16, b: 48, a: 255 },
    opacity: 1,
    visible: true,
  };
}

const SFX_FILL: ManagedColor = { space: 'rgb', r: 255, g: 214, b: 10, a: 255 };

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
      fill: SFX_FILL,
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
      strokes: [],
    },
  },
];

function clonePresetEffects(effects: Effect[]): Effect[] {
  return effects.map((effect) => ({ ...effect }));
}

function upsertEffects(existing: Effect[] | undefined, incoming: Effect[]): Effect[] {
  const next = [...(existing ?? [])];
  for (const effect of incoming) {
    const index = next.findIndex((candidate) => candidate.id && candidate.id === effect.id);
    if (index >= 0) {
      next[index] = { ...effect };
    } else {
      next.push(effect);
    }
  }
  return next;
}

function cloneFills(fills: Fill[] | undefined): Fill[] | undefined {
  if (!fills) return undefined;
  return fills.map((fill) => ({ ...fill }));
}

function colorsEqual(left: ManagedColor | undefined, right: ManagedColor): boolean {
  if (!left) return false;
  return left.space === right.space && JSON.stringify(left) === JSON.stringify(right);
}

function fillStillMatchesPreset(node: TextNode, fill: ManagedColor): boolean {
  if (node.paintRefs && node.paintRefs.length > 0) return false;
  if (node.fills && node.fills.length > 0) {
    const visible = node.fills.filter((entry) => entry.visible !== false);
    if (visible.length !== 1) return false;
    const current = visible[0]!;
    return current.type === 'solid' && colorsEqual(current.color, fill);
  }
  return colorsEqual(node.fill, fill);
}

function applyPresetFill(
  node: TextNode,
  fill: ManagedColor,
): Partial<Pick<TextNode, 'fill' | 'fills'>> {
  if (node.paintRefs && node.paintRefs.length > 0) return {};
  if (node.fills && node.fills.length > 0) {
    const nextFills = [...node.fills];
    const solidIndex = nextFills.findIndex(
      (entry) => entry.type === 'solid' && entry.visible !== false,
    );
    if (solidIndex >= 0) {
      const current = nextFills[solidIndex]!;
      nextFills[solidIndex] = { ...current, type: 'solid', color: fill };
    } else {
      nextFills.push({
        type: 'solid',
        color: fill,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      });
    }
    return { fill, fills: nextFills };
  }
  return { fill };
}

function captureRestore(node: TextNode): Pick<TextEffectState, 'restoreFill' | 'restoreFills'> {
  return {
    ...(node.fill ? { restoreFill: { ...node.fill } } : {}),
    ...(node.fills ? { restoreFills: cloneFills(node.fills) } : {}),
  };
}

function restoreFillFromPreset(
  node: TextNode,
  stored: TextEffectState | undefined,
): Partial<TextNode> {
  if (!stored || (node.paintRefs && node.paintRefs.length > 0)) return {};
  if (!fillStillMatchesPreset(node, SFX_FILL)) return {};
  return {
    ...(stored.restoreFill ? { fill: stored.restoreFill } : {}),
    ...(stored.restoreFills ? { fills: stored.restoreFills } : {}),
  };
}

function withoutTextEffect(node: TextNode): TextNode {
  const { textEffect: _discarded, ...rest } = node;
  return rest as TextNode;
}

/** Apply a preset to a text node without touching content or geometry. */
export function applyTextEffectPreset(node: TextNode, preset: TextEffectPreset): TextNode {
  const { fill, strokes, effects, ...typography } = preset.patch;
  let next: TextNode = { ...node, ...typography };

  if (strokes) {
    next = { ...next, strokes: cloneStrokesWithFreshIds(strokes) };
  }

  if (preset.id === 'body-reset') {
    return {
      ...withoutTextEffect(next),
      effects: (node.effects ?? []).filter((effect) => effect.id !== SFX_IMPACT_SHADOW_ID),
    };
  }

  if (preset.id === 'sfx-impact' && fill) {
    const restore =
      node.textEffect?.preset === 'sfx-impact' ? node.textEffect : captureRestore(node);
    const shadow = sfxShadow();
    const incoming = clonePresetEffects(effects ?? [shadow]).map((effect) =>
      effect.id === SFX_IMPACT_SHADOW_ID ? shadow : effect,
    );
    return {
      ...next,
      ...applyPresetFill(node, fill),
      effects: upsertEffects(node.effects, incoming),
      textEffect: {
        preset: 'sfx-impact',
        restoreFill: restore.restoreFill,
        restoreFills: restore.restoreFills,
      },
    };
  }

  if (effects) {
    next = { ...next, effects: upsertEffects(node.effects, clonePresetEffects(effects)) };
  }
  if (fill) {
    next = { ...next, ...applyPresetFill(node, fill) };
  }
  return next;
}

/** Remove SFX outline and shadow, restoring the fill captured when the preset was applied. */
export function clearTextEffectPreset(node: TextNode): TextNode {
  const restored = restoreFillFromPreset(node, node.textEffect);
  return {
    ...withoutTextEffect(node),
    strokes: [],
    effects: (node.effects ?? []).filter((effect) => effect.id !== SFX_IMPACT_SHADOW_ID),
    ...restored,
  };
}

/** The patch that removes only the outline a preset added. */
export const CLEAR_TEXT_EFFECT_PATCH: TextEffectPatch = { strokes: [] };

export function textEffectPresetById(id: string): TextEffectPreset | undefined {
  return TEXT_EFFECT_PRESETS.find((preset) => preset.id === id);
}
