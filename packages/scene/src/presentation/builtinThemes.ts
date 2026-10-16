import { DEFAULT_ARTWORK_FONT_FAMILY } from '@varve/shared';
import type { Document } from '../document';
import { createTextStyle } from '../styles';
import { createPresentationTheme, type PresentationThemeRole } from './themes';
import type { PresentationTheme } from './types';

/**
 * Eight original built-in themes.
 *
 * A preset is a definition, not live state: applying one materializes one
 * ordinary document colour variable per role (in the same "Presentation
 * themes" collection sampled themes use) plus heading/body text styles, and
 * the theme record links roles to those ids. Nothing here bypasses the
 * variable or style systems, so presets remain editable afterwards like any
 * author-created theme.
 *
 * Typography differentiates the presets by role scale and weight policy over
 * the bundled artwork family. More family variety needs licensed typefaces,
 * which is a packaging decision recorded in the presentation docs, not
 * something to fake with unavailable system fonts.
 */

export interface PresentationBuiltInTypography {
  /** Heading/body base weight for the theme's text styles. */
  weight: number;
  /** Role size scale relative to the 58px title / 24px body basis. */
  scale: number;
  lineHeight?: number;
}

export interface PresentationBuiltInTheme {
  id: string;
  name: string;
  description: string;
  colors: Record<PresentationThemeRole, string>;
  heading: PresentationBuiltInTypography;
  body: PresentationBuiltInTypography;
}

export const PRESENTATION_BUILT_IN_THEMES: readonly PresentationBuiltInTheme[] = [
  {
    id: 'builtin-studio',
    name: 'Studio',
    description: 'Dark charcoal stage, warm type, teal accent',
    colors: {
      title: '#f5f2ea',
      subtitle: '#b8bdc9',
      body: '#d8dbe2',
      caption: '#8f96a3',
      accent: '#2fbfa7',
      background: '#16181d',
    },
    heading: { weight: 700, scale: 1 },
    body: { weight: 400, scale: 1 },
  },
  {
    id: 'builtin-paper',
    name: 'Paper',
    description: 'Warm paper, rust accent, generous leading',
    colors: {
      title: '#26221c',
      subtitle: '#5a5347',
      body: '#3a352c',
      caption: '#84796a',
      accent: '#a4452f',
      background: '#faf6ef',
    },
    heading: { weight: 600, scale: 1.02, lineHeight: 1.15 },
    body: { weight: 400, scale: 1.12, lineHeight: 1.5 },
  },
  {
    id: 'builtin-midnight',
    name: 'Midnight',
    description: 'Deep navy with pale blue text and a cyan signal',
    colors: {
      title: '#e8ecff',
      subtitle: '#9fb0e8',
      body: '#c3cdf0',
      caption: '#6f7db0',
      accent: '#37d3e0',
      background: '#0b1026',
    },
    heading: { weight: 700, scale: 1 },
    body: { weight: 400, scale: 1, lineHeight: 1.45 },
  },
  {
    id: 'builtin-meridian',
    name: 'Meridian',
    description: 'White ground, black display type, orange accent',
    colors: {
      title: '#111111',
      subtitle: '#4f4f4f',
      body: '#2b2b2b',
      caption: '#767676',
      accent: '#e2571b',
      background: '#ffffff',
    },
    heading: { weight: 700, scale: 1.1 },
    body: { weight: 400, scale: 0.95, lineHeight: 1.35 },
  },
  {
    id: 'builtin-canopy',
    name: 'Canopy',
    description: 'Deep green field, cream type, lime accent',
    colors: {
      title: '#f2f7e8',
      subtitle: '#9db894',
      body: '#cfe0c6',
      caption: '#71866c',
      accent: '#a3d977',
      background: '#12291c',
    },
    heading: { weight: 600, scale: 1 },
    body: { weight: 400, scale: 1.05, lineHeight: 1.45 },
  },
  {
    id: 'builtin-signal',
    name: 'Signal',
    description: 'Cool light gray, ink text, signal-yellow accent',
    colors: {
      title: '#191919',
      subtitle: '#555555',
      body: '#333333',
      caption: '#777777',
      accent: '#f2b705',
      background: '#f2f2f0',
    },
    heading: { weight: 700, scale: 1 },
    body: { weight: 400, scale: 1 },
  },
  {
    id: 'builtin-mosaic',
    name: 'Mosaic',
    description: 'Soft warm gray with plum structure accents',
    colors: {
      title: '#2d1f2d',
      subtitle: '#6d5c6d',
      body: '#473a47',
      caption: '#8d7f8d',
      accent: '#7c4d8f',
      background: '#f6f1ee',
    },
    heading: { weight: 600, scale: 1, lineHeight: 1.2 },
    body: { weight: 400, scale: 1.05 },
  },
  {
    id: 'builtin-monochrome',
    name: 'Monochrome',
    description: 'Pure grayscale structure, no hue anywhere',
    colors: {
      title: '#000000',
      subtitle: '#555555',
      body: '#222222',
      caption: '#888888',
      accent: '#555555',
      background: '#ffffff',
    },
    heading: { weight: 700, scale: 1 },
    body: { weight: 400, scale: 1 },
  },
] as const satisfies readonly PresentationBuiltInTheme[];

export function findBuiltInPresentationTheme(id: string): PresentationBuiltInTheme | undefined {
  return PRESENTATION_BUILT_IN_THEMES.find((preset) => preset.id === id);
}

const TITLE_BASIS_PX = 58;
const BODY_BASIS_PX = 24;

/**
 * Materializes one built-in preset into real document variables and text
 * styles and registers the theme record. Idempotent: an already-materialized
 * preset returns the document unchanged, so repeated applies cannot stack
 * duplicate variables or styles.
 */
export function createBuiltInPresentationTheme(document: Document, themeId: string): Document {
  const preset = findBuiltInPresentationTheme(themeId);
  if (!preset) throw new Error(`unknown built-in presentation theme: ${themeId}`);
  if (document.presentation?.themes.some((theme) => theme.id === preset.id)) return document;

  let next = createPresentationTheme(document, {
    id: preset.id,
    name: preset.name,
    colors: preset.colors,
  });

  const headingStyle = createTextStyle(next, `${preset.name} heading`, {
    fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: preset.heading.weight,
    fontSize: Math.round(TITLE_BASIS_PX * preset.heading.scale),
    ...(preset.heading.lineHeight !== undefined ? { lineHeight: preset.heading.lineHeight } : {}),
  });
  next = headingStyle.doc;
  const bodyStyle = createTextStyle(next, `${preset.name} body`, {
    fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: preset.body.weight,
    fontSize: Math.round(BODY_BASIS_PX * preset.body.scale),
    ...(preset.body.lineHeight !== undefined ? { lineHeight: preset.body.lineHeight } : {}),
  });
  next = bodyStyle.doc;

  const themes = (next.presentation?.themes ?? []).map(
    (theme): PresentationTheme =>
      theme.id === preset.id
        ? {
            ...theme,
            textStyles: {
              title: headingStyle.style.id,
              subtitle: headingStyle.style.id,
              body: bodyStyle.style.id,
              caption: bodyStyle.style.id,
            },
          }
        : theme,
  );
  next = { ...next, presentation: { ...next.presentation!, themes } };
  return next;
}
/**
 * Role list narrowed for consumers that only theme text roles.
 */
export const PRESENTATION_TEXT_THEME_ROLES: readonly PresentationThemeRole[] = [
  'title',
  'subtitle',
  'body',
  'caption',
];
