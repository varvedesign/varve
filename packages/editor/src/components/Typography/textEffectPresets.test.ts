import { createDefaultEffect, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyTextEffectPreset,
  CLEAR_TEXT_EFFECT_PATCH,
  clearTextEffectPreset,
  SFX_IMPACT_SHADOW_ID,
  TEXT_EFFECT_PRESETS,
  textEffectPresetById,
} from './textEffectPresets';

function makeText(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: 'text-1',
    kind: 'text',
    name: 'Dialogue',
    text: 'We leave at dawn.',
    transform: [1, 0, 0, 1, 40, 80],
    w: 220,
    h: 96,
    fontSize: 18,
    fontFamily: 'Inter',
    fontWeight: 400,
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    storyBinding: { storyId: 'story-1', threadIndex: 0 },
    richText: { paragraphs: [{ runs: [{ text: 'We leave at dawn.' }] }] },
    ...overrides,
  } as unknown as TextNode;
}

describe('text effect presets', () => {
  it('declares unique, described presets', () => {
    const ids = TEXT_EFFECT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of TEXT_EFFECT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
    expect(textEffectPresetById('sfx-impact')).toBeDefined();
    expect(textEffectPresetById('missing')).toBeUndefined();
  });

  it('never touches content, story binding, or geometry', () => {
    const node = makeText();
    for (const preset of TEXT_EFFECT_PRESETS) {
      const next = applyTextEffectPreset(node, preset);
      expect(next.text).toBe(node.text);
      expect(next.richText).toEqual(node.richText);
      expect(next.storyBinding).toEqual(node.storyBinding);
      expect(next.transform).toEqual(node.transform);
      expect(next.w).toBe(node.w);
      expect(next.h).toBe(node.h);
    }
  });

  it('the sound effect preset produces heavy uppercase display type with an outline', () => {
    const next = applyTextEffectPreset(makeText(), textEffectPresetById('sfx-impact')!);
    expect(next.textCase).toBe('uppercase');
    expect(next.fontWeight).toBe(900);
    expect(next.textAlign).toBe('center');
    expect(next.fill).toMatchObject({ r: 255, g: 214, b: 10, a: 255 });
    expect(next.strokes).toHaveLength(1);
    expect(next.strokes?.[0]?.weight).toBeGreaterThanOrEqual(8);
    expect(next.strokes?.[0]?.color).toMatchObject({ r: 0, g: 0, b: 0 });
    const shadow = next.effects?.find((effect) => effect.type === 'dropShadow');
    expect(shadow).toMatchObject({ x: 5, y: 7, id: SFX_IMPACT_SHADOW_ID });
  });

  it('keeps an existing glow when applying the sound effect preset', () => {
    const glow = createDefaultEffect('layerBlur', 'author-glow');
    const next = applyTextEffectPreset(
      makeText({ effects: [glow] }),
      textEffectPresetById('sfx-impact')!,
    );
    expect(next.effects?.some((effect) => effect.id === 'author-glow')).toBe(true);
    expect(next.effects?.some((effect) => effect.id === SFX_IMPACT_SHADOW_ID)).toBe(true);
  });

  it('writes the SFX fill onto an existing fill stack and leaves paintRefs alone', () => {
    const stacked = applyTextEffectPreset(
      makeText({
        fills: [
          {
            type: 'solid',
            color: { space: 'rgb', r: 10, g: 10, b: 10, a: 255 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      }),
      textEffectPresetById('sfx-impact')!,
    );
    expect(stacked.fills?.[0]).toMatchObject({
      type: 'solid',
      color: { r: 255, g: 214, b: 10, a: 255 },
    });

    const referenced = applyTextEffectPreset(
      makeText({
        paintRefs: ['paint-ink'],
        fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
      }),
      textEffectPresetById('sfx-impact')!,
    );
    expect(referenced.paintRefs).toEqual(['paint-ink']);
    expect(referenced.fill).toMatchObject({ r: 16, g: 21, b: 31, a: 255 });
  });

  it('the body-text preset removes the outline without wiping effects or fill', () => {
    const glow = createDefaultEffect('layerBlur', 'author-glow');
    const withSfx = applyTextEffectPreset(
      makeText({ effects: [glow] }),
      textEffectPresetById('sfx-impact')!,
    );
    const next = applyTextEffectPreset(withSfx, textEffectPresetById('body-reset')!);
    expect(next.strokes).toEqual([]);
    expect(next.fontSize).toBe(18);
    expect(next.text).toBe('We leave at dawn.');
    expect(next.fill).toMatchObject({ r: 255, g: 214, b: 10, a: 255 });
    expect(next.effects?.some((effect) => effect.id === 'author-glow')).toBe(true);
    expect(next.effects?.some((effect) => effect.id === SFX_IMPACT_SHADOW_ID)).toBe(false);
  });

  it('clear sound effect lettering restores the prior fill and removes the shadow', () => {
    const original = makeText({ fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 } });
    const withSfx = applyTextEffectPreset(original, textEffectPresetById('sfx-impact')!);
    expect(withSfx.textEffect?.preset).toBe('sfx-impact');
    expect(withSfx.effects?.[0]).not.toHaveProperty('sfxRestoreFill');
    const cleared = clearTextEffectPreset(withSfx);
    expect(cleared.strokes).toEqual([]);
    expect(cleared.effects?.some((effect) => effect.id === SFX_IMPACT_SHADOW_ID)).toBe(false);
    expect(cleared.fill).toMatchObject({ r: 16, g: 21, b: 31, a: 255 });
    expect(cleared.textEffect).toBeUndefined();
  });

  it('clear keeps a fill the author set after applying the sound effect', () => {
    const original = makeText({ fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 } });
    const withSfx = applyTextEffectPreset(original, textEffectPresetById('sfx-impact')!);
    const recoloured = {
      ...withSfx,
      fill: { space: 'rgb' as const, r: 10, g: 80, b: 200, a: 255 },
    };
    const cleared = clearTextEffectPreset(recoloured);
    expect(cleared.fill).toMatchObject({ r: 10, g: 80, b: 200, a: 255 });
    expect(cleared.textEffect).toBeUndefined();
  });

  it('the clear patch removes only the outline', () => {
    const withOutline = applyTextEffectPreset(makeText(), textEffectPresetById('outline')!);
    const next = { ...withOutline, ...CLEAR_TEXT_EFFECT_PATCH };
    expect(next.strokes).toEqual([]);
    expect(next.textCase).toBe(withOutline.textCase);
    expect(next.fontWeight).toBe(withOutline.fontWeight);
  });

  it('clones preset strokes per node so two applications do not share ids', () => {
    const preset = textEffectPresetById('sfx-impact')!;
    const first = applyTextEffectPreset(makeText({ id: 'a' }), preset);
    const second = applyTextEffectPreset(makeText({ id: 'b' }), preset);
    expect(first.strokes?.[0]?.id).toBeTruthy();
    expect(second.strokes?.[0]?.id).toBeTruthy();
    expect(first.strokes?.[0]?.id).not.toBe(second.strokes?.[0]?.id);
  });
});
