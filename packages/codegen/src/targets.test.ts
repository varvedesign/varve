/**
 * Target-registry integrity.
 *
 * The registry exists because two panels each restated what a target *is*, and
 * one of them therefore labelled a stylesheet emitter "HTML/CSS". These tests
 * hold the registry to being the single declaration: every declared format is
 * answered for, every label describes what its emitter emits, every target
 * generates a real bundle, and no authored name can steer a generated path.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  CODE_TARGETS,
  type CodeExportFormat,
  codeTarget,
  extensionForTarget,
  gapsForFormat,
  sanitiseFileStem,
} from './targets';

const NODE = 'n1' as NodeId;

function fixture(name = 'Card'): { doc: Document; node: SceneNode } {
  const node = {
    kind: 'shape',
    id: NODE,
    name,
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    fill: { space: 'rgb', r: 20, g: 40, b: 60, a: 255 },
  } as unknown as SceneNode;
  const doc = {
    nodes: { [NODE]: node },
    rootChildren: [NODE],
    pages: [],
    guides: [],
  } as unknown as Document;
  return { doc, node };
}

/** Formats the codebase genuinely cannot answer for, each with a reason. */
const UNANALYSED: CodeExportFormat[] = ['react'];

describe('CODE_TARGETS', () => {
  it('declares unique ids', () => {
    const ids = CODE_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every target a non-empty label, note, extension and highlight key', () => {
    for (const target of CODE_TARGETS) {
      expect(target.label.length, target.id).toBeGreaterThan(0);
      expect(target.note.length, target.id).toBeGreaterThan(0);
      expect(target.extension.startsWith('.'), target.id).toBe(true);
      expect(target.highlight.length, target.id).toBeGreaterThan(0);
      expect(target.analysisFormats.length, target.id).toBeGreaterThan(0);
    }
  });

  it('answers for every analysis format except the documented exclusions', () => {
    const formats: CodeExportFormat[] = [
      'css',
      'react',
      'react-cssmodules',
      'react-tailwind',
      'flutter',
      'swiftui',
      'compose',
      'svg',
      'svg-component',
      'vue',
      'svelte',
      'web-component',
    ];
    for (const format of formats) {
      const analyser = gapsForFormat(format);
      if (UNANALYSED.includes(format)) {
        // Absence is a decision, not an oversight: the react emitter lives in
        // index.ts and cannot be registered without an import cycle.
        expect(analyser, format).toBeUndefined();
        continue;
      }
      expect(analyser, format).toBeTypeOf('function');
    }
  });

  it('routes svg-component to the SVG analyser', () => {
    expect(gapsForFormat('svg-component')).toBe(gapsForFormat('svg'));
  });

  it('names the stylesheet target for what it emits, not for markup', () => {
    const css = codeTarget('css');
    expect(css.label).toBe('CSS');
    // The regression: the label used to claim HTML, which the emitter never
    // produced. A CSS bundle must contain no markup and must say so.
    const { doc, node } = fixture();
    const bundle = css.generate(node, doc);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0]?.language).toBe('css');
    expect(bundle.files[0]?.contents).not.toMatch(/<(div|section|body|html)\b/i);
    expect(bundle.setup?.join(' ')).toMatch(/markup/i);
  });

  it('generates a resolvable bundle for every target', () => {
    const { doc, node } = fixture();
    for (const target of CODE_TARGETS) {
      const bundle = target.generate(node, doc);
      expect(bundle.files.length, target.id).toBeGreaterThan(0);
      const entry = bundle.files.find((file) => file.entry) ?? bundle.files[0];
      expect(entry?.contents.length, target.id).toBeGreaterThan(0);
      expect(entry?.mimeType.length, target.id).toBeGreaterThan(0);
      // A generated path must be a single relative segment, never a separator
      // and never a parent reference.
      for (const file of bundle.files) {
        expect(file.path, `${target.id}:${file.path}`).not.toMatch(/[/\\]/);
        expect(file.path, `${target.id}:${file.path}`).not.toContain('..');
      }
    }
  });

  it('keeps the declared extension consistent with the generated file name', () => {
    const { doc, node } = fixture();
    for (const target of CODE_TARGETS) {
      const entry = target.generate(node, doc).files[0];
      expect(entry?.path.endsWith(target.extension), `${target.id}:${entry?.path}`).toBe(true);
      expect(extensionForTarget(target.id)).toBe(target.extension);
    }
  });

  it('throws for an unknown target rather than silently picking one', () => {
    expect(() => codeTarget('nope' as never)).toThrow(/unknown code target/);
  });
});

describe('sanitiseFileStem', () => {
  it('strips path separators so a layer name cannot steer the output path', () => {
    expect(sanitiseFileStem('a/b/c', 'x')).toBe('a-b-c');
    // Both the separators and the `..` runs are removed, and the removal
    // leaves no dash artefact behind.
    expect(sanitiseFileStem('..\\..\\etc\\passwd', 'x')).toBe('etc-passwd');
  });

  it('removes leading dot runs and trailing dots or spaces', () => {
    expect(sanitiseFileStem('...hidden', 'x')).toBe('hidden');
    expect(sanitiseFileStem('name. ', 'x')).toBe('name');
  });

  it('drops control characters and characters illegal in a file name', () => {
    expect(sanitiseFileStem('a\u0000b', 'x')).toBe('ab');
    expect(sanitiseFileStem('a<b>c:d"e|f?g*h', 'x')).toBe('abcdefgh');
  });

  it('falls back rather than producing an empty name', () => {
    expect(sanitiseFileStem('...', 'fallback')).toBe('fallback');
    expect(sanitiseFileStem('', 'fallback')).toBe('fallback');
  });

  it('keeps a generated bundle path safe for an adversarial layer name', () => {
    const { doc, node } = fixture('../../escape/<script>');
    const entry = codeTarget('css').generate(node, doc).files[0];
    expect(entry?.path).not.toContain('..');
    expect(entry?.path).not.toContain('/');
    expect(entry?.path.endsWith('.css')).toBe(true);
  });
});
