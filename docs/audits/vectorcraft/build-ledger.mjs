#!/usr/bin/env node
/**
 * Build docs/audits/vectorcraft/issue-ledger.jsonl from the frozen inventory.
 *
 * Classification is deliberately conservative: an issue only becomes
 * "applicable" when its subject maps onto a subsystem Varve actually ships.
 * Everything else records a concrete exclusion reason (format Varve does not
 * read, VectorCraft-specific platform/packaging, host-tool integration, ...).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Usage: node build-ledger.mjs <outDir> [index.json]
// The index is derived from the public issue API; the raw pages are kept
// outside Git (see README.md).
const SRC = process.argv[3] ?? '/tmp/opencode/vectorcraft/index.json';
const OUT_DIR = process.argv[2];
const CUTOFF = '2026-10-21T19:31:11Z';

const index = JSON.parse(readFileSync(SRC, 'utf8'));
// comment counts + body text are in the raw issue pages; index has body_len only
const raw = index;

const FORMAT_OUT_OF_SCOPE = [
  'dxf',
  'dwg',
  'wmf',
  'emf',
  'cdr',
  'coreldraw',
  'affinity',
  '.af',
  'pmd',
  'pagemaker',
  'stl',
  'hpgl',
  'hpg',
  'jxl',
  'jpeg xl',
  'svgz',
  'android vector drawable',
  'indd',
  'idml',
  'sketch file',
  'figma file',
  'formats',
  'file format',
];
const HOST_OUT_OF_SCOPE = [
  'mcp',
  'control channel',
  'cli',
  'plugin',
  'plug-in',
  'script',
  'extendscript',
  'javascript',
  'automation',
  'agent',
  'applescript',
  'vbs',
  'actions',
  '.aia',
  'command_batch',
  'command_run',
  'document.export',
  'text.create',
  'text.fitheadline',
  'recolor.apply',
  'file.place',
  'select.',
];
const PLATFORM_OUT_OF_SCOPE = [
  'flatpak',
  'flathub',
  'homebrew',
  'cask',
  'appimage',
  'rpm',
  'aur',
  'dockerfile',
  'launcher',
  'arm64',
  'arm support',
  'windows on arm',
  'android',
  'ios',
  'mobile',
  'portable mode',
  'codesign',
  'dmg',
  'release',
  'installer',
  'download page',
  'getartcraft',
  'discord',
  'petition',
  'translation',
  'interface translation',
  'ui translation',
  'language change',
];
const PRODUCT_OUT_OF_SCOPE = [
  '3d',
  'materials',
  'pbr',
  'materialx',
  'gltf',
  'photocraft',
  'effectcraft',
  'pdfcraft',
  'artcraft',
  'suite',
  'intertwine',
  'mockup',
  'gis',
  'tiling',
  'plotter',
  'laser',
  'trotec',
  'rayjet',
  'torrent',
  'magnet',
  'cloud documents',
  'real-time collaboration',
  'collaboration over local network',
  'plug-in api',
];

/** Which Varve subsystem a subject maps to, or null when it maps to none. */
function classify(title, labels) {
  const t = title.toLowerCase();
  const has = (words) => words.some((w) => t.includes(w));

  // Save/recovery first: highest severity class.
  if (
    has(['save', 'reopen', 'autosave', 'recovery', 'corrupt', 'lost data', 'data loss', 'unsaved'])
  ) {
    return { area: 'persistence', relevance: 'applicable' };
  }
  if (
    has([
      'crash',
      'panic',
      'freeze',
      'freezes',
      'hang',
      'hangs',
      'not responding',
      'out of memory',
      'leak',
      'memory',
    ])
  ) {
    return { area: 'stability', relevance: 'applicable' };
  }
  if (has(['performance', 'slow', 'lag', 'laggy', 'sluggish', 'fps', 'quadratic'])) {
    return { area: 'performance', relevance: 'applicable' };
  }
  // Formats.
  if (has(['svg'])) return { area: 'import-export-svg', relevance: 'applicable' };
  if (has(['pdf'])) return { area: 'import-export-pdf', relevance: 'applicable' };
  if (has(['eps', 'postscript', '.ai', 'illustrator', 'ai file', 'ai import', 'ai export'])) {
    return { area: 'import-ai-eps', relevance: 'applicable' };
  }
  if (
    has([
      'png',
      'jpeg',
      'jpg',
      'tiff',
      'raster export',
      'export for screens',
      'asset export',
      'export as',
    ])
  ) {
    return { area: 'export-raster', relevance: 'applicable' };
  }
  // Typography.
  if (
    has([
      'text',
      'type tool',
      'font',
      'glyph',
      'kerning',
      'leading',
      'tracking',
      'justif',
      'hyphen',
      'baseline',
      'cjk',
      'japanese',
      'arabic',
      'mojikumi',
      'vertical text',
      'area type',
      'paragraph',
      'tab ',
    ])
  ) {
    return { area: 'typography', relevance: 'applicable' };
  }
  // Geometry.
  if (
    has([
      'path',
      'anchor',
      'bezier',
      'boolean',
      'pathfinder',
      'compound',
      'offset',
      'outline stroke',
      'expand stroke',
      'join',
      'simplify',
      'corner radius',
      'shape builder',
      'divide',
      'trim',
      'merge',
      'warp',
      'zig zag',
      'roughen',
      'blend',
    ])
  ) {
    return { area: 'geometry', relevance: 'applicable' };
  }
  // Paint.
  if (
    has([
      'gradient',
      'color',
      'colour',
      'swatch',
      'blend mode',
      'opacity',
      'effect',
      'shadow',
      'glow',
      'blur',
      'mesh',
      'cmyk',
      'icc',
      'overprint',
      'spot',
    ])
  ) {
    return { area: 'paint-color', relevance: 'applicable' };
  }
  // Canvas interaction.
  if (
    has([
      'zoom',
      'pan',
      'ruler',
      'guide',
      'grid',
      'snap',
      'marquee',
      'selection',
      'cursor',
      'hit test',
      'hit-test',
    ])
  ) {
    return { area: 'canvas-interaction', relevance: 'applicable' };
  }
  if (has(['layer', 'group', 'artboard', 'page', 'symbol', 'isolation', 'reorder'])) {
    return { area: 'document-model', relevance: 'applicable' };
  }
  if (
    has([
      'keyboard',
      'shortcut',
      'focus',
      'dialog',
      'accessib',
      'contrast',
      'screen reader',
      'aria',
    ])
  ) {
    return { area: 'accessibility-ui', relevance: 'applicable' };
  }
  return null;
}

function exclusionReason(title) {
  const t = title.toLowerCase();
  const hit = (words) => words.find((w) => t.includes(w));
  const f = hit(FORMAT_OUT_OF_SCOPE);
  if (f) return `format-not-supported:${f}`;
  const h = hit(HOST_OUT_OF_SCOPE);
  if (h) return `host-automation-surface:${h}`;
  const p = hit(PLATFORM_OUT_OF_SCOPE);
  if (p) return `vectorcraft-platform-packaging:${p}`;
  const o = hit(PRODUCT_OUT_OF_SCOPE);
  if (o) return `product-out-of-scope:${o}`;
  return 'no-varve-subsystem-mapped';
}

/**
 * Issues whose mechanism was inspected against Varve source and, where noted,
 * reproduced. `research` and `engineering` are tracked separately: a fully
 * reviewed issue can still have open engineering work.
 */
const REVIEWED = {
  864: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'export-svg',
    varve_code: 'packages/codegen/src/svg.ts (root width/height)',
    observed:
      'Varve world units are CSS px at 96 dpi (packages/shared/src/units.ts); SVG user units are also 96 dpi CSS px, so an A4 page exports as 793.7 units and still measures 210 mm.',
    outcome:
      'No change required; covered by packages/codegen/src/svg-font-fallback.test.ts ("SVG physical size").',
    priority: 'none',
    validation: 'unit test',
    doc_impact: 'none',
  },
  2924: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'export-svg',
    varve_code: 'packages/codegen/src/svg.ts:1460',
    observed:
      'Duplicate of 864. Not reproducible in Varve: no points-based user unit, so no 75 % scale error.',
    outcome: 'Already handled; regression test added.',
    priority: 'none',
    validation: 'unit test',
    doc_impact: 'none',
  },
  3135: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '335b4ce96 (PR #165)',
    varve_area: 'export-svg',
    varve_code: 'packages/codegen/src/svg.ts svgFontFamilyValue',
    observed:
      'font-family carried only the design face, so viewers without it fell back to their default serif.',
    outcome:
      'Every SVG text site now appends the generic family from the shared email/CSS classification.',
    priority: 'medium',
    validation: 'unit tests',
    doc_impact: 'none',
  },
  1028: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '335b4ce96 (PR #165)',
    varve_area: 'geometry',
    varve_code: 'packages/engine/src/pathOffset.ts',
    observed:
      'Per-join arc steps scaled linearly with the user distance (unbounded output), round joins were unreachable for real corners, and open paths bridged their two ends.',
    outcome:
      'Tolerance-based bounded tessellation, hard point ceiling, real round joins, open-path endpoints.',
    priority: 'critical',
    validation: 'unit tests + visual',
    doc_impact: 'none',
  },
  1693: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '335b4ce96 (PR #165)',
    varve_area: 'persistence',
    varve_code: 'packages/editor/src/context/usePersistence.ts, persistence/librarySave.ts',
    observed:
      'A Varve Library save reused the secondary mirror call, so a failed library write still marked the document clean, cleared recovery and allowed a close.',
    outcome:
      'The library call is now the primary write; failure keeps the document dirty and returns a named save issue.',
    priority: 'high',
    validation: 'unit tests',
    doc_impact: 'contributes to docs/architecture save notes',
  },
  1685: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '335b4ce96 (PR #165)',
    varve_area: 'persistence',
    varve_code: 'persistence/librarySave.ts, components/StatusBar/SaveStatusIndicator.tsx',
    observed:
      'Filesystem save failures already keep the document dirty and expose a save issue in the status bar and Document Info. The library path did not.',
    outcome: 'Same contract now holds for library saves.',
    priority: 'high',
    validation: 'unit tests',
    doc_impact: 'none',
  },
  1471: {
    research: 'reviewed-thread',
    engineering: 'applicable-requires-work',
    varve_area: 'typography',
    varve_code:
      'packages/engine/src/replay.ts (hasVerticalOverflow), packages/scene/src/typographyPreflight.ts',
    observed:
      'Area-text overflow is computed for the ellipsis decision and then discarded; ordinary area text bleeds or clips with no overset indicator, and the preflight overset check is permanently unavailable.',
    outcome:
      'Proposed: surface overset as a derived status and preflight finding. Not implemented in this pass.',
    priority: 'medium',
    validation: 'none yet',
    doc_impact: 'preflight docs',
  },
  1140: {
    research: 'reviewed-thread',
    engineering: 'applicable-requires-work',
    varve_area: 'paint-color',
    varve_code:
      'crates/varve-print/src/lib.rs (ShadingRegistry), packages/engine/src/replayGradient.ts',
    observed:
      'Canvas interpolates gradient stops with premultiplied alpha; the PDF shading sampler discards stop alpha entirely, so gradient transparency is export-only loss.',
    outcome:
      'Proposed: emit per-stop alpha (function output + SMask) and premultiplied sampling. Not implemented in this pass.',
    priority: 'high',
    validation: 'none yet',
    doc_impact: 'print compatibility notes',
  },
  861: {
    research: 'reviewed-thread',
    engineering: 'applicable-requires-work',
    varve_area: 'persistence',
    varve_code: 'packages/editor/src/context.tsx:9548 (openFile), context/usePersistence.ts:225',
    observed:
      'Varve substitutes a blank document when provided JSON fails to decode or validate, and loadDocument swallows invalid JSON entirely. A file that cannot be read therefore opens as an empty canvas under the same name, with no visible error — and saving over it is one keystroke away.',
    outcome:
      'Proposed: keep the current document, return a failure, and show a persistent, dismissible error naming the file and reason. Not implemented: it needs a visible error surface, not just the visually hidden announcer.',
    priority: 'high',
    validation: 'none yet',
    doc_impact: 'troubleshooting docs',
  },
  136: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'export-svg',
    varve_code: 'packages/codegen/src/css.ts:291, svg.ts:889/1203',
    observed:
      'Varve writes the numeric weight (font-weight: 600 / font-weight="600"), never a name-to-keyword mapping, so Light/Medium/Semibold cannot collapse to regular/bold.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'code inspection',
    doc_impact: 'none',
  },
  352: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'accessibility-ui',
    varve_code: 'packages/editor/src/components/Inspector/controls/NumberField.tsx:441',
    observed: 'NumberField steps with ArrowUp/Down (Shift x10, Alt x0.1) and PageUp/PageDown.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'existing unit tests',
    doc_impact: 'none',
  },
  307: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'accessibility-ui',
    varve_code: 'packages/ui/src/components/Dialog.tsx:112-125',
    observed:
      'Dialogs move focus to the first control and fall back to a documented focus-fallback target.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'code inspection',
    doc_impact: 'none',
  },
  1293: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'geometry',
    varve_code: 'packages/editor/src/context.tsx:9680 (createLiveBooleanForSelection)',
    observed:
      'Pathfinder commands create a live boolean group over the original nodes, so names and ids survive; expanding is explicit.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'code inspection',
    doc_impact: 'none',
  },
  1280: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'performance',
    varve_code: 'packages/editor/src/scene/spatialIndex.ts, hitTest/HitTestEngine.ts',
    observed:
      'Hover and marquee queries use a cached 64 px grid, not a full document scan; the one whole-document branch is master-placement mode.',
    outcome:
      'Already handled for ordinary editing; master-placement scan recorded as a bounded follow-up.',
    priority: 'low',
    validation: 'existing bench',
    doc_impact: 'none',
  },
};

const rows = [];
const counts = {};
for (const issue of raw) {
  const c = classify(issue.title, issue.labels);
  const reviewed = REVIEWED[issue.n];
  const disposition = reviewed
    ? reviewed.engineering
    : c
      ? 'screened-relevant'
      : 'outside-varve-scope';
  const reason = c ? `maps-to:${c.area}` : exclusionReason(issue.title);
  if (!counts[c ? c.area : reason]) counts[c ? c.area : reason] = 0;
  counts[c ? c.area : reason]++;
  rows.push({
    id: issue.n,
    url: `https://github.com/storytold/vectorcraft/issues/${issue.n}`,
    title: issue.title,
    source_state: issue.state,
    created_at: issue.created,
    closed_at: issue.closed,
    labels: issue.labels,
    comments: issue.comments,
    body_length: issue.body_len,
    review: { depth: 'title', cutoff: CUTOFF },
    disposition,
    disposition_reason: reason,
    ...(reviewed ?? {}),
  });
}

const sorted = rows.sort((a, b) => a.id - b.id);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/issue-ledger.jsonl`,
  sorted.map((r) => JSON.stringify(r)).join('\n') + '\n',
);
writeFileSync(
  `${OUT_DIR}/issue-ledger.summary.json`,
  JSON.stringify(
    {
      source: 'storytold/vectorcraft',
      cutoff: CUTOFF,
      total: sorted.length,
      open: sorted.filter((r) => r.source_state === 'open').length,
      closed: sorted.filter((r) => r.source_state === 'closed').length,
      by_disposition: sorted.reduce((acc, r) => {
        acc[r.disposition] = (acc[r.disposition] ?? 0) + 1;
        return acc;
      }, {}),
      by_area_or_reason: counts,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ total: sorted.length, counts }, null, 2));
