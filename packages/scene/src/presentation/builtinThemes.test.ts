import { contrastRatio, relativeLuminance } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { createDocument, makeFrameNode } from '../document';
import { createBuiltInPresentationTheme, PRESENTATION_BUILT_IN_THEMES } from './builtinThemes';
import { PRESENTATION_THEME_ROLES } from './themes';

function themedDocument(): ReturnType<typeof createDocument> {
  const frame = makeFrameNode('frame-a');
  const doc = createDocument('Built-in themes', true);
  return {
    ...doc,
    nodes: { [frame.id]: frame },
    presentation: {
      schemaVersion: 2,
      decks: [
        {
          id: 'deck',
          name: 'Deck',
          width: 1920,
          height: 1080,
          slides: [{ id: 'one', frameId: frame.id, title: 'One' }],
          sections: [],
        },
      ],
      layouts: [],
      themes: [],
    },
  };
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

describe('PRESENTATION_BUILT_IN_THEMES', () => {
  it('offers eight meaningfully different presets with complete role coverage', () => {
    expect(PRESENTATION_BUILT_IN_THEMES).toHaveLength(8);
    const ids = new Set(PRESENTATION_BUILT_IN_THEMES.map((theme) => theme.id));
    expect(ids.size).toBe(8);
    for (const theme of PRESENTATION_BUILT_IN_THEMES) {
      for (const role of PRESENTATION_THEME_ROLES) {
        expect(theme.colors[role], `${theme.id} missing ${role}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(theme.heading.weight).toBeGreaterThanOrEqual(400);
      expect(theme.body.weight).toBeGreaterThanOrEqual(400);
    }
  });

  it('keeps every title readable on its own background (WCAG AA for large text)', () => {
    for (const theme of PRESENTATION_BUILT_IN_THEMES) {
      const title = hexToRgb(theme.colors.title);
      const background = hexToRgb(theme.colors.background);
      const ratio = contrastRatio(relativeLuminance(...title), relativeLuminance(...background));
      expect(ratio, `${theme.name} title/background contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('materializes variables, text styles, and the theme record exactly once', () => {
    let doc = themedDocument();
    doc = createBuiltInPresentationTheme(doc, 'builtin-studio');
    const theme = doc.presentation?.themes.find((candidate) => candidate.id === 'builtin-studio');
    expect(theme).toBeDefined();
    expect(Object.keys(theme!.colorVariables)).toHaveLength(6);
    expect(theme!.textStyles.title).toBe(theme!.textStyles.subtitle);
    expect(theme!.textStyles.body).toBe(theme!.textStyles.caption);
    expect(theme!.textStyles.title).not.toBe(theme!.textStyles.body);

    const headingStyle = doc.styles?.[theme!.textStyles.title!];
    expect(headingStyle?.type).toBe('text');
    expect(headingStyle && 'fontWeight' in headingStyle ? headingStyle.fontWeight : undefined).toBe(
      700,
    );
    const bodyStyle = doc.styles?.[theme!.textStyles.body!];
    expect(bodyStyle && 'fontSize' in bodyStyle ? bodyStyle.fontSize : undefined).toBe(24);

    const variableNames = Object.values(doc.variableStore?.variables ?? {})
      .map((variable) => variable.name)
      .join('|');
    expect(variableNames).toContain('Studio');

    const before = JSON.stringify(doc.presentation?.themes);
    doc = createBuiltInPresentationTheme(doc, 'builtin-studio');
    expect(JSON.stringify(doc.presentation?.themes)).toBe(before);
    expect(
      Object.values(doc.variableStore?.variables ?? {}).filter((variable) =>
        variable.name.includes('Studio'),
      ),
    ).toHaveLength(6);
  });

  it('rejects unknown preset ids', () => {
    expect(() => createBuiltInPresentationTheme(themedDocument(), 'builtin-nope')).toThrow(
      /unknown built-in/,
    );
  });

  it('gives the presets distinct visual policies, not eight recolors of one scheme', () => {
    const backgrounds = new Set(
      PRESENTATION_BUILT_IN_THEMES.map((theme) => theme.colors.background),
    );
    expect(backgrounds.size).toBeGreaterThanOrEqual(6);
    const lightBackgrounds = PRESENTATION_BUILT_IN_THEMES.filter(
      (theme) => relativeLuminance(...hexToRgb(theme.colors.background)) > 0.5,
    );
    const darkBackgrounds = PRESENTATION_BUILT_IN_THEMES.filter(
      (theme) => relativeLuminance(...hexToRgb(theme.colors.background)) <= 0.5,
    );
    expect(lightBackgrounds.length).toBeGreaterThanOrEqual(4);
    expect(darkBackgrounds.length).toBeGreaterThanOrEqual(3);
  });
});
