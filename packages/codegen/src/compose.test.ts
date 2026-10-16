/**
 * Android Jetpack Compose target regressions.
 *
 * The contract under test is the one the brief holds this target to: a `.kt`
 * file with unbound references is not Compose support. So the emitter must
 * reference only what it emits or imports, must preserve token aliases instead
 * of flattening them, must use dp for lengths and sp for type, must give a
 * clickable control the documented 48dp minimum touch target, must not add a
 * redundant `contentDescription` where a text label already merges, and must
 * survive adversarial layer names without producing a broken string literal.
 *
 * Verification tier: these assert the emitted text. **Nothing here compiles
 * Kotlin** — no Kotlin toolchain exists in this environment — and the tests do
 * not claim to.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  argbColor,
  COMPOSE_TOOLCHAIN,
  composeTargetGaps,
  dp,
  exportNodeToComposeBundle,
  kotlinIdentifier,
  kotlinString,
  sp,
  tokenIdentifier,
} from './compose';

const ROOT = 'card' as NodeId;
const LABEL = 'label' as NodeId;
const TAP = 'cta' as NodeId;

function doc(overrides: Partial<Document> = {}): Document {
  const nodes: Record<NodeId, SceneNode> = {
    [ROOT]: {
      kind: 'frame',
      id: ROOT,
      name: 'Card',
      transform: [1, 0, 0, 1, 0, 0],
      w: 320,
      h: 180,
      cornerRadius: 12,
      children: [LABEL],
    } as unknown as SceneNode,
    [LABEL]: {
      kind: 'text',
      id: LABEL,
      name: 'Title',
      transform: [1, 0, 0, 1, 16, 24],
      text: 'Hello',
      fontSize: 18,
      fill: { space: 'rgb', r: 17, g: 34, b: 51, a: 255 },
    } as unknown as SceneNode,
  };
  return {
    nodes,
    rootChildren: [ROOT],
    pages: [],
    guides: [],
    ...overrides,
  } as unknown as Document;
}

/** The public bundle API takes a node, matching the other emitters. */
function nodeOf(d: Document, id: NodeId): SceneNode {
  const node = d.nodes[id];
  if (!node) throw new Error(`missing node ${id}`);
  return node;
}

describe('kotlinString', () => {
  it('escapes the template sigil so a layer name cannot interpolate', () => {
    expect(kotlinString('$name')).toBe('"\\$name"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${` is the input under test
    expect(kotlinString('a${b}c')).toBe('"a\\${b}c"');
  });

  it('escapes backslashes before quotes so no escape can be re-formed', () => {
    // A name ending in a backslash must not escape the closing quote.
    expect(kotlinString('path\\')).toBe('"path\\\\"');
    expect(kotlinString('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes newlines and tabs into single-line literals', () => {
    expect(kotlinString('a\nb')).toBe('"a\\nb"');
    expect(kotlinString('a\tb')).toBe('"a\\tb"');
  });

  it('keeps a script-closing sequence inert', () => {
    expect(kotlinString('</script>')).toBe('"</script>"');
  });
});

describe('kotlinIdentifier', () => {
  it('produces PascalCase that cannot collide with a Kotlin keyword', () => {
    // Every Kotlin keyword is lowercase, so PascalCase is structurally safe.
    expect(kotlinIdentifier('fun')).toBe('Fun');
    expect(kotlinIdentifier('object')).toBe('Object');
    expect(kotlinIdentifier('is')).toBe('Is');
  });

  it('never returns an identifier starting with a digit', () => {
    expect(kotlinIdentifier('2x')).toMatch(/^[A-Za-z_]/);
  });

  it('strips the template sigil from an identifier', () => {
    expect(kotlinIdentifier('a$b')).not.toContain('$');
  });

  it('falls back for a name with no usable characters', () => {
    expect(kotlinIdentifier('', 'Fallback')).toBe('Fallback');
  });
});

describe('units', () => {
  it('emits integral lengths without a trailing .0', () => {
    expect(dp(24)).toBe('24.dp');
    expect(dp(12.5)).toBe('12.50.dp');
  });

  it('uses sp for type sizes', () => {
    expect(sp(16)).toBe('16.sp');
    expect(sp(13.5)).toBe('13.50.sp');
  });

  it('formats colours as 0xAARRGGBB', () => {
    expect(argbColor({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as never)).toBe(
      'Color(0xFFFF0000)',
    );
    expect(argbColor({ space: 'rgb', r: 0, g: 0, b: 0, a: 0 } as never)).toBe('Color(0x00000000)');
  });
});

describe('exportNodeToComposeBundle', () => {
  const bundle = () => exportNodeToComposeBundle(nodeOf(doc(), ROOT), doc());

  it('emits a Kotlin file as the entry point', () => {
    const b = exportNodeToComposeBundle(nodeOf(doc(), ROOT), doc());
    expect(b.target).toBe('compose');
    expect(b.deliverable).toBe('component');
    const entry = b.files.find((f) => f.entry);
    expect(entry?.language).toBe('kotlin');
    expect(entry?.path).toBe('Card.kt');
    expect(entry?.mimeType).toBe('text/x-kotlin');
    expect(entry?.contents.startsWith('package ')).toBe(true);
  });

  it('gives a clickable root the documented 48dp minimum touch target', () => {
    const withTap = doc({
      interactions: {
        [ROOT]: [
          {
            id: 'ix',
            nodeId: ROOT,
            name: 'tap',
            trigger: { kind: 'onClick' },
            actions: [{ kind: 'goBack' }],
            enabled: true,
          },
        ],
      },
    } as unknown as Partial<Document>);
    const b = exportNodeToComposeBundle(nodeOf(withTap, ROOT), withTap);
    const contents = b.files.find((f) => f.entry)?.contents ?? '';
    expect(contents).toContain('sizeIn(minWidth = 48.dp, minHeight = 48.dp)');
    expect(contents).toContain('.clickable(onClick = onClick)');
    expect(contents).toContain('fun Card(onClick: () -> Unit = {})');
    // `sizeIn` must precede `clickable` so the target grows around the control.
    expect(contents.indexOf('sizeIn(')).toBeLessThan(contents.indexOf('.clickable('));
  });

  it('does not duplicate a semantics label when a text descendant already merges', () => {
    const withTap = doc({
      interactions: {
        [ROOT]: [
          { id: 'ix', nodeId: ROOT, name: 'tap', trigger: { kind: 'onClick' }, enabled: true },
        ],
      },
    } as unknown as Partial<Document>);
    const contents =
      exportNodeToComposeBundle(nodeOf(withTap, ROOT), withTap).files.find((f) => f.entry)
        ?.contents ?? '';
    expect(contents).not.toContain('contentDescription =');
  });

  it('labels a clickable with no text descendant', () => {
    const bare = doc({
      interactions: {
        [ROOT]: [
          { id: 'ix', nodeId: ROOT, name: 'tap', trigger: { kind: 'onClick' }, enabled: true },
        ],
      },
    } as unknown as Partial<Document>);
    const nodes = bare.nodes as Record<NodeId, SceneNode>;
    (nodes[ROOT] as unknown as { children: NodeId[] }).children = [];
    const contents =
      exportNodeToComposeBundle(nodeOf(bare, ROOT), bare).files.find((f) => f.entry)?.contents ??
      '';
    expect(contents).toContain('contentDescription = "Card"');
  });

  it('ignores a disabled interaction', () => {
    const disabled = doc({
      interactions: {
        [ROOT]: [
          {
            id: 'ix',
            nodeId: ROOT,
            name: 'tap',
            trigger: { kind: 'onClick' },
            actions: [],
            enabled: false,
          },
        ],
      },
    } as unknown as Partial<Document>);
    const contents =
      exportNodeToComposeBundle(nodeOf(disabled, ROOT), disabled).files.find((f) => f.entry)
        ?.contents ?? '';
    expect(contents).not.toContain('clickable');
    expect(contents).toContain('fun Card()');
  });

  it('produces a resolvable file: every Tokens reference has a Tokens file', () => {
    const b = bundle();
    const contents = b.files.find((f) => f.entry)?.contents ?? '';
    if (contents.includes('Tokens.')) {
      expect(b.files.some((f) => f.path === 'Tokens.kt')).toBe(true);
    } else {
      expect(b.files.some((f) => f.path === 'Tokens.kt')).toBe(false);
    }
  });

  it('declares the pinned toolchain and the unverified tier in setup', () => {
    const b = bundle();
    const setup = b.setup?.join('\n') ?? '';
    expect(setup).toContain(COMPOSE_TOOLCHAIN.composeUi);
    expect(setup).toContain(COMPOSE_TOOLCHAIN.composeBom);
    expect(setup).toContain(String(COMPOSE_TOOLCHAIN.minSdk));
    // The official pages disagree about minSdk; that must be disclosed, not hidden.
    expect(setup).toMatch(/21/);
    expect(setup).toMatch(/not been compiled/i);
  });

  it('reports the unverified verification tier as a diagnostic', () => {
    const b = bundle();
    const tier = b.diagnostics.find((d) => d.feature === 'verification');
    expect(tier).toBeTruthy();
    expect(tier?.message).toMatch(/no Kotlin compiler ran/i);
  });

  it('never emits an inert handler for a nested interaction', () => {
    const nested = doc();
    const nodes = nested.nodes as Record<NodeId, SceneNode>;
    (nodes[ROOT] as unknown as { children: NodeId[] }).children = [LABEL, TAP];
    nodes[TAP] = {
      kind: 'shape',
      id: TAP,
      name: 'Nested CTA',
      transform: [1, 0, 0, 1, 16, 120],
      shape: { kind: 'rect', x: 0, y: 0, w: 120, h: 44 },
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    } as unknown as SceneNode;
    (nested as unknown as { interactions: unknown }).interactions = {
      [TAP]: [{ id: 'ix2', nodeId: TAP, name: 'tap', trigger: { kind: 'onClick' }, actions: [] }],
    };
    const b = exportNodeToComposeBundle(nodeOf(nested, ROOT), nested);
    const contents = b.files.find((f) => f.entry)?.contents ?? '';
    // Only the root may carry onClick.
    expect(contents.match(/clickable\(/g)?.length ?? 0).toBe(0);
    const gap = b.diagnostics.find((d) => d.feature === 'interaction:onClick');
    expect(gap?.nodeName).toBe('Nested CTA');
    expect(gap?.fallback).toMatch(/inert/i);
  });

  it('omits a non-primitive shape with a stated fallback instead of faking it', () => {
    const star = doc();
    const nodes = star.nodes as Record<NodeId, SceneNode>;
    (nodes[ROOT] as unknown as { children: NodeId[] }).children = ['star-node'];
    nodes['star-node'] = {
      kind: 'shape',
      id: 'star-node',
      name: 'Star',
      transform: [1, 0, 0, 1, 0, 0],
      shape: {
        kind: 'star',
        cx: 10,
        cy: 10,
        innerRadius: 4,
        outerRadius: 9,
        points: 5,
        rotation: 0,
      },
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    } as unknown as SceneNode;
    const b = exportNodeToComposeBundle(nodeOf(star, ROOT), star);
    const contents = b.files.find((f) => f.entry)?.contents ?? '';
    expect(contents).toContain('has no Compose primitive');
    expect(b.diagnostics.some((d) => d.feature === 'shape:star')).toBe(true);
  });

  it('survives an adversarial layer name without breaking the literal', () => {
    const nasty = doc();
    const nodes = nasty.nodes as Record<NodeId, SceneNode>;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: adversarial input under test
    (nodes[LABEL] as unknown as { text: string }).text = '</script> ${evil} "quoted" \\';
    const b = exportNodeToComposeBundle(nodeOf(nasty, ROOT), nasty);
    const contents = b.files.find((f) => f.entry)?.contents ?? '';
    // The literal must be closed: no raw `$` interpolation may survive.
    expect(contents).toContain('\\$');
    expect(contents).not.toMatch(/text = "[^"]*"[^,)]*\$[^\\]/);
    // Balanced braces is a weak but real structural check.
    const opens = (contents.match(/\{/g) ?? []).length;
    const closes = (contents.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe('composeTargetGaps', () => {
  it('reports a non-primitive shape with a fallback', () => {
    const node = {
      kind: 'shape',
      id: 'n',
      name: 'Poly',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'polygon', cx: 0, cy: 0, radius: 5, sides: 6, rotation: 0 },
    } as unknown as SceneNode;
    const gaps = composeTargetGaps(node, doc());
    expect(gaps.some((g) => g.feature.startsWith('non-primitive shape'))).toBe(true);
  });

  it('reports no shape gap for a rectangle', () => {
    const node = {
      kind: 'shape',
      id: 'n',
      name: 'Rect',
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    } as unknown as SceneNode;
    expect(composeTargetGaps(node, doc())).toEqual([]);
  });

  it('reports rotation as an unsupported property', () => {
    const node = {
      kind: 'shape',
      id: 'n',
      name: 'Rot',
      rotation: 30,
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    } as unknown as SceneNode;
    expect(composeTargetGaps(node, doc()).some((g) => g.feature === 'rotation')).toBe(true);
  });
});

describe('leaf appearance regression', () => {
  /** A plain filled rectangle with no children — the common export case. */
  function leaf(): Document {
    return {
      nodes: {
        leaf: {
          kind: 'shape',
          id: 'leaf',
          name: 'Swatch',
          transform: [1, 0, 0, 1, 0, 0],
          shape: { kind: 'rect', x: 0, y: 0, w: 80, h: 40 },
          fill: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
          cornerRadius: 6,
        } as unknown as SceneNode,
      },
      rootChildren: ['leaf'],
      pages: [],
      guides: [],
    } as unknown as Document;
  }

  const contents = (): string => {
    const d = leaf();
    const node = d.nodes.leaf as SceneNode;
    return exportNodeToComposeBundle(node, d).files.find((f) => f.entry)?.contents ?? '';
  };

  it('keeps a leaf fill, size and clip on the emitted box', () => {
    // The blocker: a leaf path returned a bare offset box, so a filled
    // rectangle exported with no background at all.
    const out = contents();
    expect(out).toContain('background(Color(0xFF0A141E))');
    expect(out).toContain('.size(80.dp, 40.dp)');
    expect(out).toContain('.clip(RoundedCornerShape(6.dp))');
  });

  it('imports RectangleShape whenever it can be emitted', () => {
    // `RectangleShape` is the default clip for a node without a corner radius,
    // and was emitted while never being imported.
    const d = leaf();
    const node = d.nodes.leaf as unknown as { cornerRadius?: number; kind: string };
    delete node.cornerRadius;
    const out =
      exportNodeToComposeBundle(d.nodes.leaf as SceneNode, d).files.find((f) => f.entry)
        ?.contents ?? '';
    expect(out).toContain('RectangleShape');
    expect(out).toContain('import androidx.compose.foundation.shape.RectangleShape');
  });
});

describe('tokenIdentifier', () => {
  it('keeps a digit-leading token name a valid identifier', () => {
    // `Tokens.2x` is a syntax error.
    expect(tokenIdentifier('2x')).toBe('T_2x');
    expect(tokenIdentifier('2x')).toMatch(/^[A-Za-z_]/);
  });

  it('collapses differently-spaced names onto one identifier', () => {
    // Two such names share a collector key, so the object cannot declare a
    // duplicate `val`.
    expect(tokenIdentifier('brand-teal')).toBe(tokenIdentifier('brand.teal'));
  });

  it('falls back rather than producing an empty identifier', () => {
    expect(tokenIdentifier('---')).toBe('___');
    expect(tokenIdentifier('')).toBe('Token');
  });
});
