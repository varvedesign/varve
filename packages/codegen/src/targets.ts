/**
 * Code-generation target registry — the single declaration of what each target
 * *is*.
 *
 * Why this module exists: the two code panels each declared their own target
 * list and their own label for each target. That is how the CSS target came to
 * be labelled "HTML/CSS" in one panel while the other correctly called it
 * "CSS": the name was restated per surface instead of being derived from the
 * emitter behind it. A label, a deliverable kind, a file extension and a
 * capability report are all claims *about an emitter*, so they belong beside
 * the dispatch that picks the emitter.
 *
 * Scope of this first step: every target whose emitter lives in its own module.
 * Three exclusions, each for a stated reason:
 *
 *   - **`react`** — `exportNodeToReact` is defined *inside* `index.ts`
 *     (around line 1000) rather than in a `react.ts`. Registering it here would
 *     make this module import `index.ts`, which already re-exports this module:
 *     a cycle. Moving that emitter into its own module is the prerequisite, and
 *     it is deliberately not bundled into this change.
 *   - **`html`** — `exportIrToHtml` takes the design IR, not a node, so it
 *     needs the IR-building path rather than a string adapter. No target claims
 *     HTML until that exists.
 *   - **`svg-component`** — an analysis format with no emitter of its own; the
 *     SVG descriptor answers for it.
 *
 * Panels may still choose which subset of targets they surface; that is a
 * presentation decision. They must not restate what a target means, which is
 * what this registry removes.
 */

import type { NodeId, Document as SceneDocument, SceneNode, VariableStore } from '@varve/scene';
import { composeTargetGaps, exportNodeToComposeBundle } from './compose';
import { cssTargetGaps, exportNodeToCss } from './css';
import { cssModulesTargetGaps, exportNodeToCssModulesBundle } from './css-modules';
import { exportNodeToFlutter, flutterTargetGaps } from './flutter';
import { exportNodeToSvelte } from './svelte';
import { exportNodeToSvg, svgTargetGaps } from './svg';
import { exportNodeToSwiftUI, swiftuiTargetGaps } from './swiftui';
import { exportNodeToTailwindBundle, tailwindTargetGaps } from './tailwind';
import {
  type BundleDiagnostic,
  type CodeDeliverableKind,
  type GeneratedBundle,
  type GeneratedFileLanguage,
  mimeTypeForLanguage,
  type TargetGap,
} from './types';
import { exportNodeToVue } from './vue';
import { exportNodeToWebComponent } from './web-component';

/** Analysis vocabulary: which capability analyser applies to a target. */
export type CodeExportFormat =
  | 'css'
  | 'react'
  | 'react-cssmodules'
  | 'react-tailwind'
  | 'flutter'
  | 'swiftui'
  | 'compose'
  | 'svg'
  | 'svg-component'
  | 'vue'
  | 'svelte'
  | 'web-component';

/** Stable identity of a code target as the UI presents it. */
export type CodeTargetId =
  | 'css'
  | 'tailwind'
  | 'modules'
  | 'vue'
  | 'svelte'
  | 'web-component'
  | 'svg'
  | 'flutter'
  | 'swiftui'
  | 'compose';

export interface CodeTargetOptions {
  variableStore?: VariableStore;
  unit?: 'px' | 'rem';
  baseFontSize?: number;
}

export interface CodeTargetDescriptor {
  id: CodeTargetId;
  /** The user-visible name. Must describe what the emitter actually emits. */
  label: string;
  /** What the consumer receives. Drives the handoff instructions. */
  deliverable: CodeDeliverableKind;
  /** Analysis formats this target's analyser answers for. */
  analysisFormats: readonly CodeExportFormat[];
  /** Download extension, without the dot. */
  extension: string;
  /** Grammar key for the syntax highlighter (`syntax.ts` LANG_MAP). */
  highlight: string;
  /**
   * One line stating the deliverable and its limits. Shown to the developer, so
   * it must not overstate: a stylesheet is not a page and a snippet is not an
   * app.
   */
  note: string;
  /** Capability report for this target. */
  gaps: (node: SceneNode, doc: SceneDocument) => TargetGap[];
  /** The bundle contract. Every target produces one; strings are adapters. */
  generate: (node: SceneNode, doc: SceneDocument, opts?: CodeTargetOptions) => GeneratedBundle;
}

/**
 * Wrap a single-string emitter as a one-file bundle.
 *
 * The bundle is the contract everywhere in this package; the string emitters
 * keep their convenient signatures but stop being a competing output shape.
 * The file name is path-sanitised so an authored layer name cannot introduce a
 * separator or a traversal segment.
 */
export function singleFileBundle(
  node: SceneNode,
  language: GeneratedFileLanguage,
  contents: string,
  extension: string,
  deliverable: CodeDeliverableKind,
  diagnostics: BundleDiagnostic[] = [],
  setup?: string[],
): GeneratedBundle {
  return {
    target: language,
    deliverable,
    files: [
      {
        path: `${sanitiseFileStem(node.name, 'export')}${extension}`,
        language,
        mimeType: mimeTypeForLanguage(language),
        contents,
        entry: true,
      },
    ],
    dependencies: {},
    setup,
    diagnostics,
  };
}

/**
 * A single path segment safe to write to disk. Never empty, never a parent ref.
 *
 * Order matters. Separators become dashes first so the name stays one segment;
 * then any run of two or more dots is removed because `..` is a traversal
 * primitive even without a separator; then dashes are collapsed and edges
 * trimmed so the removals cannot leave `-..-` artefacts behind.
 */
export function sanitiseFileStem(name: string, fallback: string): string {
  const cleaned = Array.from(name.replace(/[\\/]+/g, '-'))
    // Control characters (C0 and DEL) and characters illegal in a file name are
    // filtered by code point rather than by a regex class, so no literal control
    // range has to exist in the source.
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code <= 31 || code === 127) return false;
      return !'<>:"|?*'.includes(character);
    })
    .join('')
    // `..` and longer dot runs are traversal primitives in any position.
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function stringTarget(input: {
  id: CodeTargetId;
  label: string;
  language: GeneratedFileLanguage;
  extension: string;
  highlight: string;
  note: string;
  analysisFormats: readonly CodeExportFormat[];
  emit: (node: SceneNode, doc: SceneDocument, opts?: CodeTargetOptions) => string;
}): CodeTargetDescriptor {
  return {
    id: input.id,
    label: input.label,
    deliverable: 'snippet',
    analysisFormats: input.analysisFormats,
    extension: input.extension,
    highlight: input.highlight,
    note: input.note,
    // The Vue/Svelte/Web Component emitters have no capability analyser yet;
    // an empty report would imply "no gaps", so the descriptor says so instead
    // of manufacturing a clean bill of health.
    gaps: () => [
      {
        nodeId: '',
        nodeName: '',
        feature: 'capability analysis',
        severity: 'info',
        fallback: `No capability analyser for ${input.id}; inspect the output manually`,
      },
    ],
    generate: (node, doc, opts) =>
      singleFileBundle(
        node,
        input.language,
        input.emit(node, doc, opts),
        input.extension,
        'snippet',
      ),
  };
}

export const CODE_TARGETS: readonly CodeTargetDescriptor[] = [
  {
    id: 'css',
    label: 'CSS',
    deliverable: 'snippet',
    analysisFormats: ['css'],
    extension: '.css',
    highlight: 'css',
    note: 'One rule per layer, absolutely positioned. This is a stylesheet fragment — it needs HTML markup to render.',
    gaps: cssTargetGaps,
    generate: (node, doc, opts) =>
      singleFileBundle(
        node,
        'css',
        exportNodeToCss(node, doc, {
          variableStore: opts?.variableStore,
          unit: opts?.unit,
          baseFontSize: opts?.baseFontSize,
        }),
        '.css',
        'snippet',
        [],
        [
          'Paste the rules into a stylesheet and supply the markup yourself — a CSS file alone is not a page.',
        ],
      ),
  },
  {
    id: 'tailwind',
    label: 'Tailwind',
    deliverable: 'component',
    analysisFormats: ['react-tailwind'],
    extension: '.tsx',
    highlight: 'tailwind',
    note: 'A React component using Tailwind utilities. Requires Tailwind in the consumer project.',
    gaps: tailwindTargetGaps,
    generate: (node, doc, opts) =>
      exportNodeToTailwindBundle(node, doc, {
        variableStore: opts?.variableStore,
        baseFontSize: opts?.baseFontSize,
      }),
  },
  {
    id: 'modules',
    label: 'Modules',
    deliverable: 'component',
    analysisFormats: ['react-cssmodules'],
    extension: '.tsx',
    highlight: 'modules',
    note: 'A React component and its CSS Module. Both files are required; copying only the component will not render.',
    gaps: cssModulesTargetGaps,
    generate: (node, doc, opts) =>
      exportNodeToCssModulesBundle(node, doc, {
        variableStore: opts?.variableStore,
        unit: opts?.unit,
        baseFontSize: opts?.baseFontSize,
      }),
  },
  {
    id: 'flutter',
    label: 'Flutter',
    deliverable: 'snippet',
    analysisFormats: ['flutter'],
    extension: '.dart',
    highlight: 'flutter',
    note: 'A Flutter widget expression. Paste it into a widget tree — it is not a runnable app.',
    gaps: flutterTargetGaps,
    generate: (node, doc, opts) =>
      singleFileBundle(
        node,
        'dart',
        exportNodeToFlutter(node, doc, { variableStore: opts?.variableStore }),
        '.dart',
        'snippet',
      ),
  },
  {
    id: 'swiftui',
    label: 'SwiftUI',
    deliverable: 'snippet',
    analysisFormats: ['swiftui'],
    extension: '.swift',
    highlight: 'swiftui',
    note: 'A SwiftUI view expression. Paste it into a View body — it is not a runnable app.',
    gaps: swiftuiTargetGaps,
    generate: (node, doc, opts) =>
      singleFileBundle(
        node,
        'swift',
        exportNodeToSwiftUI(node, doc, { variableStore: opts?.variableStore }),
        '.swift',
        'snippet',
      ),
  },
  {
    id: 'compose',
    label: 'Compose',
    deliverable: 'component',
    analysisFormats: ['compose'],
    extension: '.kt',
    highlight: 'kotlin',
    note: 'An Android Jetpack Compose composable. Emitted and statically checked only — no Kotlin compiler ran on it, so the first build is the check.',
    gaps: composeTargetGaps,
    generate: (node, doc, opts) =>
      exportNodeToComposeBundle(node, doc, { variableStore: opts?.variableStore }),
  },
  {
    id: 'svg',
    label: 'SVG',
    deliverable: 'asset',
    analysisFormats: ['svg', 'svg-component'],
    extension: '.svg',
    highlight: 'svg',
    note: 'A standalone SVG document of the selected subtree. Open it in a browser or import it into a design tool.',
    gaps: svgTargetGaps,
    generate: (node, doc) =>
      singleFileBundle(node, 'svg', exportNodeToSvg(node, doc), '.svg', 'asset'),
  },
  stringTarget({
    id: 'vue',
    label: 'Vue',
    language: 'vue',
    extension: '.vue',
    highlight: 'vue',
    note: 'A Vue single-file-component fragment. It is not registered or mounted for you.',
    analysisFormats: ['vue'],
    emit: (node, doc) => exportNodeToVue(node, doc),
  }),
  stringTarget({
    id: 'svelte',
    label: 'Svelte',
    language: 'svelte',
    extension: '.svelte',
    highlight: 'svelte',
    note: 'A Svelte component fragment. It is not registered or mounted for you.',
    analysisFormats: ['svelte'],
    emit: (node, doc) => exportNodeToSvelte(node, doc),
  }),
  stringTarget({
    id: 'web-component',
    label: 'Web Component',
    language: 'js',
    extension: '.js',
    highlight: 'web-component',
    note: 'A custom-element class. You must define the tag name and register it.',
    analysisFormats: ['web-component'],
    emit: (node, doc) => exportNodeToWebComponent(node, doc),
  }),
];

/** Look up a descriptor. Throws rather than falling back to a wrong target. */
export function codeTarget(id: CodeTargetId): CodeTargetDescriptor {
  const found = CODE_TARGETS.find((target) => target.id === id);
  if (!found) throw new Error(`unknown code target: ${id}`);
  return found;
}

/**
 * Capability reporter for an analysis format, or undefined when no target
 * answers for it. `react` is unmapped for the cycle reason stated at the top of
 * this module.
 */
export function gapsForFormat(
  format: CodeExportFormat,
): ((node: SceneNode, doc: SceneDocument) => TargetGap[]) | undefined {
  return CODE_TARGETS.find((target) => target.analysisFormats.includes(format))?.gaps;
}

/** `nodeId → extension` for a target, so the download control cannot restate it. */
export function extensionForTarget(id: CodeTargetId): string {
  return codeTarget(id).extension;
}

export type { NodeId };
