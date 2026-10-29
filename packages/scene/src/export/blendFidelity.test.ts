import { describe, expect, it } from 'vitest';
import {
  describeUnrepresentedBlends,
  findUnrepresentedBlends,
  isBlendModeRepresentable,
} from './blendFidelity';

/**
 * The PDF names the Rust writer in `crates/varve-print/src/blend.rs` can emit.
 *
 * `blendModeCatalog.pdf` is the declared contract for these; the Rust table is
 * the only code that writes them and is kept exhaustive by its `match`. This
 * list is pinned here so a catalog change forces a look at the encoder rather
 * than silently widening what the product claims to carry.
 */
const PDF_REPRESENTABLE = [
  'normal',
  'darken',
  'multiply',
  'colorBurn',
  'lighten',
  'screen',
  'colorDodge',
  'overlay',
  'softLight',
  'hardLight',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

const ALL_MODES = [...PDF_REPRESENTABLE, 'passThrough', 'plusLighter', 'plusDarker'] as const;

function shape(overrides: {
  id: string;
  name?: string;
  blendMode?: string;
  fills?: readonly { visible?: boolean; blendMode?: string }[];
}) {
  return overrides;
}

describe('isBlendModeRepresentable', () => {
  it('treats Normal and Pass Through as always representable', () => {
    for (const target of ['native', 'flatten', 'rasterized', 'blocked'] as const) {
      expect(isBlendModeRepresentable('normal', target)).toBe(true);
      expect(isBlendModeRepresentable('passThrough', target)).toBe(true);
    }
  });

  it('treats every mode as representable when the path rasterizes it', () => {
    for (const target of ['flatten', 'rasterized'] as const) {
      for (const mode of ALL_MODES) {
        expect(isBlendModeRepresentable(mode, target)).toBe(true);
      }
    }
  });

  it('carries a named mode natively but not an unnamed one', () => {
    expect(isBlendModeRepresentable('multiply', 'native')).toBe(true);
    expect(isBlendModeRepresentable('luminosity', 'native')).toBe(true);
    // Canvas2D has `lighter`; PDF has no blend mode for it.
    expect(isBlendModeRepresentable('plusLighter', 'native')).toBe(false);
    expect(isBlendModeRepresentable('plusDarker', 'native')).toBe(false);
  });

  it('carries no blend mode at all when the format forbids transparency', () => {
    for (const mode of PDF_REPRESENTABLE.filter((m) => m !== 'normal')) {
      expect(isBlendModeRepresentable(mode, 'blocked')).toBe(false);
    }
  });
});

describe('findUnrepresentedBlends', () => {
  it('finds object and fill level modes separately', () => {
    const found = findUnrepresentedBlends(
      [
        shape({ id: 'a', name: 'Glow', blendMode: 'screen' }),
        shape({
          id: 'b',
          name: 'Tint',
          fills: [
            { visible: true, blendMode: 'multiply' },
            { visible: false, blendMode: 'screen' },
            { visible: true, blendMode: 'normal' },
          ],
        }),
      ],
      'blocked',
    );
    expect(found).toEqual([
      { nodeId: 'a', nodeName: 'Glow', modeLabel: 'Screen', scope: 'object' },
      { nodeId: 'b', nodeName: 'Tint', modeLabel: 'Multiply', scope: 'fill' },
    ]);
  });

  it('ignores invisible fills, which paint nothing', () => {
    const found = findUnrepresentedBlends(
      [shape({ id: 'a', fills: [{ visible: false, blendMode: 'screen' }] })],
      'blocked',
    );
    expect(found).toEqual([]);
  });

  it('reports nothing for a rasterizing target', () => {
    const nodes = [
      shape({ id: 'a', blendMode: 'plusLighter' }),
      shape({ id: 'b', fills: [{ visible: true, blendMode: 'screen' }] }),
    ];
    expect(findUnrepresentedBlends(nodes, 'rasterized')).toEqual([]);
    expect(findUnrepresentedBlends(nodes, 'flatten')).toEqual([]);
  });

  it('falls back to the node id when a node has no name', () => {
    const [entry] = findUnrepresentedBlends(
      [shape({ id: 'n7', blendMode: 'multiply' })],
      'blocked',
    );
    expect(entry?.nodeName).toBe('n7');
  });
});

describe('describeUnrepresentedBlends', () => {
  it('returns null when nothing is unrepresented', () => {
    const message = describeUnrepresentedBlends(
      [shape({ id: 'a', blendMode: 'multiply' })],
      'native',
      { formatLabel: 'PDF/X-4', alternative: 'n/a' },
    );
    expect(message).toBeNull();
  });

  it('names the objects and the modes', () => {
    const message = describeUnrepresentedBlends(
      [
        shape({ id: 'a', name: 'Glow', blendMode: 'screen' }),
        shape({ id: 'b', name: 'Tint', fills: [{ visible: true, blendMode: 'multiply' }] }),
      ],
      'blocked',
      { formatLabel: 'PDF/X-1a', alternative: 'Export PDF/X-4 instead.' },
    );
    expect(message).toContain('PDF/X-1a');
    expect(message).toContain('Glow');
    expect(message).toContain('Tint');
    expect(message).toContain('Screen');
    expect(message).toContain('Multiply');
    expect(message).toContain('as if they were Normal');
    expect(message).toContain('Export PDF/X-4 instead.');
  });

  it('summarizes a long list instead of pasting every name', () => {
    const message = describeUnrepresentedBlends(
      ['a', 'b', 'c', 'd', 'e'].map((id) => shape({ id, blendMode: 'multiply' })),
      'blocked',
      { formatLabel: 'PDF/X-1a', alternative: 'n/a' },
    );
    expect(message).toContain('and 2 more');
  });
});
