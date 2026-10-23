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
function classify(title, _labels) {
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
  1140: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '89a2fac4 (sampled-function range) + b5b92eef (alpha soft mask)',
    varve_area: 'paint-color',
    varve_code:
      'crates/varve-print/src/lib.rs (ShadingRegistry); packages/engine/src/replayGradient.ts (addColorStop); packages/codegen/src/svg.ts gradient stops',
    observed:
      'The PDF shading sampler discarded stop alpha entirely, so gradient transparency survived on the canvas and in SVG but disappeared from PDF. The canvas-versus-SVG interpolation half of the report is engine behaviour, not Varve code: Canvas2D gradient interpolation and SVG stop interpolation are both browser-defined.',
    outcome:
      'PDF emits per-stop alpha through a luminosity soft mask and was rendered-verified with poppler. A browser parity probe measured Canvas2D and SVG gradients identically at t=0.1/0.5/0.9 over white in current Chromium (252/191/48), so the canvas-versus-SVG divergence reported upstream does not reproduce there. WebKit canvas parity is not measured; the desktop embeds system WebKitGTK, and the Playwright WPE bundle cannot launch in this environment without the documented userland provisioning.',
    priority: 'high',
    validation:
      'pdftoppm/pdfimages evidence under evidence/; Chromium parity probe (2026-10-23), see findings.md F11',
    doc_impact: 'print compatibility notes',
  },
  1471: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '321cf7c9 (PR #180)',
    varve_area: 'typography',
    varve_code: 'packages/editor/src/render/textOverset.ts, packages/scene/src/preflight.ts',
    observed:
      'Varve computed area-text overflow while painting and discarded it, so preflight reported overset-text as unavailable and a clipped or bleeding frame warned nobody.',
    outcome:
      'Preflight now measures area frames through the canonical layout pipeline and reports the characters that do not fit; frames it cannot measure keep the check unavailable.',
    priority: 'medium',
    validation: 'unit + e2e (Chromium and WebKitGTK)',
    doc_impact: 'preflight docs',
  },
  2323: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '321cf7c9 (PR #180)',
    duplicate_of: 1471,
    observed:
      'Same defect as 1471 from a different reporter: the overflow indicator only appeared once the frame was selected.',
    outcome: 'Covered by 1471; the measurement is independent of selection state.',
    priority: 'low',
    validation: 'same as 1471',
    doc_impact: 'none',
  },
  2769: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in: '321cf7c9 (PR #180)',
    duplicate_of: 1471,
    observed:
      'CJK area text clipped its last line with no indicator. Same mechanism as 1471, with a CJK case whose baseline offset made the clip easy to miss.',
    outcome:
      'Covered by 1471; the measurement compares each line box against the frame, so script does not change the verdict.',
    priority: 'medium',
    validation: 'same as 1471',
    doc_impact: 'none',
  },
  861: {
    research: 'reviewed-thread',
    engineering: 'integrated-verified',
    integrated_in:
      'b9114559 (PR #187); empty-payload and loadDocument/recovery follow-up in 62f01d560 and 6d6bf5213',
    varve_area: 'persistence',
    varve_code:
      'packages/editor/src/context/usePersistence.ts admitDocumentPayload (shared by openFile and loadDocument); components/Shell/RecoveryManager.tsx restore handlers',
    observed:
      'Varve substituted a blank document when provided JSON failed to decode, and loadDocument swallowed invalid JSON entirely. A zero-byte file reached openFile as an empty string, which the truthiness guard treated as the new-document request: the tab was rebound to the damaging file name while holding a blank canvas, and the next save overwrote the real file. The main editor-context loadDocument was still the unguarded copy even after the document sub-context was fixed, so a recovery restore that could not decode failed silently; RecoveryManager then deleted the snapshot anyway.',
    outcome:
      'Only null requests a new document; every other payload goes through one decode gate that reports the file by name and leaves the current document, session identity and dirty state alone. The gate is shared by openFile and the main-context loadDocument, which now returns false when it refuses so recovery keeps the only copy of an unreadable snapshot. FileReader failures from the picker are reported instead of doing nothing.',
    priority: 'high',
    validation:
      'unit: openFileUnreadable (empty/whitespace payload, loadDocument return value), openFileDedupe (real codec fixtures, dedupe and second-tab identity), RecoveryManager (failed restore keeps the snapshot; success deletes it); e2e: real File > Open picker refuses a zero-byte file and still opens a valid document',
    doc_impact: 'file-formats open section, troubleshooting',
  },
  392: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    varve_area: 'accessibility-ui',
    varve_code:
      'packages/editor/src/components/TextEditOverlay.tsx (positioned textarea), shortcuts/ShortcutManager.ts:967 shouldIgnoreShortcutTarget',
    observed:
      'Text editing happens in a real textarea, and the shortcut dispatcher suppresses editor shortcuts while focus is on an editable target, so Cmd/Ctrl+A stays inside the text field instead of selecting every object.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'code inspection + existing ShortcutManager tests',
    doc_impact: 'none',
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
  33: {
    research: 'reviewed-thread',
    engineering: 'verified-existing',
    mapped_area: 'accessibility-ui',
    varve_area: 'accessibility-ui',
    varve_code:
      'packages/editor/src/components/Inspector/controls/NumberField.tsx:754-758 (focus selects the value), :768-771 (unit is a separate span), :177-186 parseField',
    observed:
      'VectorCraft keeps the unit inside the editable text, so a double-click highlights only the number and a typed expression keeps the trailing "px". Varve’s numeric input holds only the number: the unit is a separate, non-editable span and the accessible name carries it. Focus selects the whole value, and the Pratt parser evaluates arithmetic (120/2), so the "expression plus stale suffix" state cannot occur.',
    outcome: 'No change required.',
    priority: 'none',
    validation: 'code inspection + NumberField math/alias tests',
    doc_impact: 'none',
  },
  1151: {
    research: 'reviewed-thread',
    engineering: 'screened-relevant',
    mapped_area: 'persistence',
    varve_area: 'persistence',
    varve_code:
      'apps/desktop/src-tauri/src/lib.rs read_dropped_file + tauri://drag-drop listener; packages/platform/src/tauri.ts:979; packages/editor/src/CanvasArea.tsx native drop path',
    observed:
      'Varve has a native drop path because wry/WebKitGTK consumes GTK drag signals on Linux, so HTML5 dragover/drop never reaches the page; the frontend listens for Tauri’s tauri://drag-drop event and reads the dropped path through an approved resolver. The browser drop path is separate. Whether a Nautilus-to-Wayland-native drop reaches the Tauri event has not been exercised: no Tauri session is available in this environment, and the report is Fedora/GNOME specific.',
    outcome:
      'Reclassified from a blanket out-of-scope exclusion: the surface exists and the mechanism is implemented. Remaining work is native-platform verification on a Wayland session, which cannot be manufactured from browser tests.',
    priority: 'medium',
    validation: 'code inspection only; native drop untested',
    doc_impact: 'none',
  },
  2177: {
    research: 'reviewed-thread',
    engineering: 'screened-relevant',
    mapped_area: 'import-export-pdf',
    varve_area: 'import-export-pdf',
    varve_code:
      'packages/import/src (PDF/AI parsing), packages/editor/src/importing/useFileImport.ts, render scheduling',
    observed:
      'A Vietnamese multi-defect report, not one bug: heavy PDF/AI files freeze on open (30+ minutes), some open with missing content, some .ai files render blurry, and one file does not pick up its font. The follow-up comment says waiting ~15 minutes or copying objects one by one eventually shows the text, which points at progressive decode/render and font resolution rather than at the decode gate. The linked samples are Google Drive links; they were not downloaded, so no reproduction exists here.',
    outcome:
      'Kept as open work with four distinct conditions. It is not a duplicate of the unreadable-file finding: #861 covers a payload that cannot be decoded at all, while this report describes heavy but decodable documents. Needs a bounded heavy-file benchmark plus the reporter samples.',
    priority: 'high',
    validation: 'thread read; no reproduction (attachments not downloaded)',
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
  // A reviewed row can name the subsystem it actually maps to even when the
  // title classifier misses it (a drag-and-drop report maps to the native
  // platform surface; a units-and-expressions report maps to NumberField).
  const reason = c
    ? `maps-to:${c.area}`
    : reviewed?.mapped_area
      ? `maps-to:${reviewed.mapped_area}`
      : exclusionReason(issue.title);
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
    // Depth is a property of the review actually performed. A row that was
    // read as a full thread must not keep claiming title-level depth, and an
    // unread title must not claim more.
    review: {
      depth: reviewed?.research === 'reviewed-thread' ? 'thread' : 'title',
      cutoff: CUTOFF,
    },
    disposition,
    disposition_reason: reason,
    ...(reviewed ?? {}),
  });
}

const sorted = rows.sort((a, b) => a.id - b.id);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/issue-ledger.jsonl`,
  `${sorted.map((r) => JSON.stringify(r)).join('\n')}\n`,
);
writeFileSync(
  `${OUT_DIR}/issue-ledger.summary.json`,
  `${JSON.stringify(
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
  )}\n`,
);
console.log(JSON.stringify({ total: sorted.length, counts }, null, 2));
