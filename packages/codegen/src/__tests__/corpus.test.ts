/**
 * Corpus validity + baseline capture.
 *
 * Every corpus document must be structurally valid and survive a codec
 * round-trip, or nothing downstream that uses it can be trusted. When
 * VARVE_CODEGEN_BASELINE_OUT points at a directory, the current emitters'
 * outputs for each corpus are written there for before/after inspection.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, SceneNode } from '@varve/scene';
import { DocumentCodec, validateDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';

/** Corpus builders guarantee their ids; make that contract explicit to tsc. */
function requireNode(doc: Document, id: string): SceneNode {
  const node = doc.nodes[id];
  if (!node) throw new Error(`corpus node ${id} missing`);
  return node;
}

import { exportNodeToCss } from '../css';
import { exportNodeToCssModulesBundle } from '../css-modules';
import { exportNodeToFlutter } from '../flutter';
import { exportNodeToSvg } from '../svg';
import { exportNodeToSwiftUI } from '../swiftui';
import { exportNodeToTailwindBundle } from '../tailwind';
import {
  buildComponentFamilyDoc,
  buildGraphicsShowcaseDoc,
  buildResponsivePageDoc,
  buildRichTextDoc,
  buildWrappedTextDoc,
} from './helpers/corpus';

const CORPUS_BUILDERS = [
  ['graphics-showcase', buildGraphicsShowcaseDoc],
  ['rich-text', buildRichTextDoc],
  ['wrapped-text', buildWrappedTextDoc],
  ['responsive-page', buildResponsivePageDoc],
  ['component-family', buildComponentFamilyDoc],
] as const;

describe('acceptance corpus', () => {
  for (const [name, build] of CORPUS_BUILDERS) {
    it(`builds a valid, round-tripping document: ${name}`, () => {
      const { doc } = build();
      expect(Object.keys(doc.nodes).length).toBeGreaterThan(0);
      const validation = validateDocument(doc);
      expect(validation.errors, validation.errors.join('; ')).toEqual([]);
      const json = DocumentCodec.encode(doc);
      const decoded = DocumentCodec.decode(json);
      expect(decoded.ok, decoded.ok ? '' : decoded.error).toBe(true);
      if (!decoded.ok) return;
      expect(Object.keys(decoded.document.nodes).sort()).toEqual(Object.keys(doc.nodes).sort());
    });
  }

  it('graphics showcase carries the effects under test', () => {
    const g = buildGraphicsShowcaseDoc();
    const shadowed = g.doc.nodes[g.shadowedRectId];
    expect(shadowed?.effects?.some((e) => e.type === 'dropShadow')).toBe(true);
    expect(shadowed?.effects?.some((e) => e.type === 'innerShadow')).toBe(true);
    const angular = g.doc.nodes[g.angularGradientRectId];
    expect(
      angular?.fills?.some((f) => f.type === 'gradient' && f.gradient?.type === 'angular'),
    ).toBe(true);
    expect(g.doc.nodes[g.blendedCircleId]?.blendMode).toBe('multiply');
    const masked = g.doc.nodes[g.maskedGroupId] as { mask?: { sourceNodeId?: string } };
    expect(masked.mask?.sourceNodeId).toBe('mask-source');
  });

  it('component family wires variants and overrides', () => {
    const c = buildComponentFamilyDoc();
    const component = c.doc.components[c.componentId];
    expect(component?.properties?.some((p) => p.name === 'Label')).toBe(true);
    expect(component?.variants?.some((v) => v.id === c.largeVariantId)).toBe(true);
    const instance = c.doc.nodes[c.largeInstanceId] as
      | { variant?: string; propertyOverrides?: Record<string, unknown> }
      | undefined;
    expect(instance?.variant).toBe(c.largeVariantId);
    expect(instance?.propertyOverrides?.Label).toBe('Try Varve');
  });

  it('captures current-emitter baselines when VARVE_CODEGEN_BASELINE_OUT is set', () => {
    const outDir = process.env.VARVE_CODEGEN_BASELINE_OUT;
    if (!outDir) return;
    mkdirSync(outDir, { recursive: true });

    const graphics = buildGraphicsShowcaseDoc();
    writeFileSync(
      join(outDir, 'graphics-showcase.svg'),
      exportNodeToSvg(requireNode(graphics.doc, graphics.rootId), graphics.doc),
    );
    writeFileSync(
      join(outDir, 'graphics-showcase.css'),
      exportNodeToCss(requireNode(graphics.doc, graphics.rootId), graphics.doc),
    );
    const tw = exportNodeToTailwindBundle(requireNode(graphics.doc, graphics.rootId), graphics.doc);
    for (const file of tw.files) {
      writeFileSync(join(outDir, `graphics-showcase.${file.path}`), file.contents);
    }
    writeFileSync(
      join(outDir, 'graphics-showcase-modules.tsx'),
      exportNodeToCssModulesBundle(requireNode(graphics.doc, graphics.rootId), graphics.doc)
        .files[0]?.contents ?? '',
    );
    writeFileSync(
      join(outDir, 'graphics-showcase.dart'),
      exportNodeToFlutter(requireNode(graphics.doc, graphics.rootId), graphics.doc),
    );
    writeFileSync(
      join(outDir, 'graphics-showcase.swift'),
      exportNodeToSwiftUI(requireNode(graphics.doc, graphics.rootId), graphics.doc),
    );

    const rich = buildRichTextDoc();
    writeFileSync(
      join(outDir, 'rich-text.svg'),
      exportNodeToSvg(requireNode(rich.doc, rich.rootId), rich.doc),
    );
    const wrapped = buildWrappedTextDoc();
    writeFileSync(
      join(outDir, 'wrapped-text.svg'),
      exportNodeToSvg(requireNode(wrapped.doc, wrapped.rootId), wrapped.doc),
    );
    const page = buildResponsivePageDoc();
    writeFileSync(
      join(outDir, 'responsive-page.css'),
      exportNodeToCss(requireNode(page.doc, page.rootId), page.doc),
    );
    const pageTw = exportNodeToTailwindBundle(requireNode(page.doc, page.rootId), page.doc);
    for (const file of pageTw.files) {
      writeFileSync(join(outDir, `responsive-page.${file.path}`), file.contents);
    }
  });
});
