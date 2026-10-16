/**
 * Target analysis — detect feature gaps for a given export format across
 * an entire document or a set of nodes.
 *
 * Each code emitter exposes a `targetGaps(node, doc)` companion that reports
 * unsupported features for that node/format pair. This module aggregates those
 * reports document-wide so the Export dialog can show a preflight summary.
 */

import type { Document, SceneNode } from '@varve/scene';
import type { CodeExportFormat } from './targets';
import { gapsForFormat } from './targets';
import type { TargetGap } from './types';

/**
 * Code-export format identifiers. The union now lives in the target registry,
 * which is the single declaration of which targets exist; this re-export keeps
 * existing importers working without giving them a second copy to drift from.
 */
export type { CodeExportFormat };

/** Summary of all gaps found in a document for a given format. */
export interface TargetAnalysisResult {
  format: CodeExportFormat;
  gaps: TargetGap[];
  errorCount: number;
  warningCount: number;
}

type GapFn = (node: SceneNode, doc: Document) => TargetGap[];

/**
 * Gap reporters, resolved from the target registry.
 *
 * This was a second hand-maintained map of the same knowledge the registry now
 * holds, which is how a target could exist in one place and not the other.
 * `react` has no analyser because its emitter lives in `index.ts` and cannot be
 * registered without a cycle; it reports no gaps explicitly rather than by
 * omission, so the absence is a decision rather than an oversight.
 */
const GAP_FNS: Record<CodeExportFormat, GapFn> = {
  css: gapsForFormat('css') ?? (() => []),
  react: () => [],
  'react-cssmodules': gapsForFormat('react-cssmodules') ?? (() => []),
  'react-tailwind': gapsForFormat('react-tailwind') ?? (() => []),
  flutter: gapsForFormat('flutter') ?? (() => []),
  swiftui: gapsForFormat('swiftui') ?? (() => []),
  compose: gapsForFormat('compose') ?? (() => []),
  svg: gapsForFormat('svg') ?? (() => []),
  'svg-component': gapsForFormat('svg-component') ?? (() => []),
  vue: gapsForFormat('vue') ?? (() => []),
  svelte: gapsForFormat('svelte') ?? (() => []),
  'web-component': gapsForFormat('web-component') ?? (() => []),
};

/**
 * Collect all `TargetGap` entries for every node in `doc` for the given
 * export format. Walks the full node map (not just root children) so nested
 * nodes inside frames and groups are also checked.
 */
export function analyseDocument(doc: Document, format: CodeExportFormat): TargetAnalysisResult {
  const gapFn = GAP_FNS[format];
  const gaps: TargetGap[] = [];

  for (const node of Object.values(doc.nodes)) {
    const nodeGaps = gapFn(node, doc);
    gaps.push(...nodeGaps);
  }

  return {
    format,
    gaps,
    errorCount: gaps.filter((g) => g.severity === 'error').length,
    warningCount: gaps.filter((g) => g.severity === 'warning').length,
  };
}

/**
 * Check a single node against a format and return its gaps.
 * Convenience wrapper for use in the Inspector panel.
 */
export function analyseNode(node: SceneNode, doc: Document, format: CodeExportFormat): TargetGap[] {
  return GAP_FNS[format](node, doc);
}

/**
 * Return true if the given format string is a code-export format
 * supported by target analysis (as opposed to raster/print formats).
 */
export function isCodeExportFormat(format: string): format is CodeExportFormat {
  return format in GAP_FNS;
}
