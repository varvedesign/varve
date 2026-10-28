export const ROOT = new URL('../../../', import.meta.url).pathname;

export const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

if (args.has('help') || args.has('h')) {
  process.stdout.write(`Usage: node scripts/perf/run-production-workload.mjs [options]

Options:
  --mode=canvas2d-main|canvas2d-worker|webgl2
  --fixture=<id>                 Deterministic document fixture
  --workloads=<a,b,...>          Gesture workloads (default: standard interaction set)
  --iterations=<count>           Requested measured samples (minimum 100 accepted)
  --warmup=<count>               Warmup gestures (default: 10)
  --quality=automatic|full       Interactive preview quality
  --width=<pixels> --height=<pixels> --dpr=<scale>
  --headed                       Use the local browser/display for compatibility screening
  --preflight-only               Build and verify the requested renderer without timing
  --base=<url>                   Use an existing production preview
  --out=<path>                   Write the evidence report
  --help, -h                     Show this help without building or launching a browser

Headless Chromium uses SwiftShader by default. Browser gesture timings do not
qualify native Tauri/WebKitGTK hardware performance or physical presentation.
`);
  process.exit(0);
}

const ITERATIONS = Number(args.get('iterations') ?? 120);
export const WARMUP = Number(args.get('warmup') ?? 10);
export const MIN_WARM_SAMPLES = 100;
const MAX_ATTEMPTS = 500;
const ATTEMPTS = Math.min(MAX_ATTEMPTS, Math.max(ITERATIONS + WARMUP, WARMUP + MIN_WARM_SAMPLES));
export const MEASURED_ATTEMPTS = ATTEMPTS - WARMUP;
export const ALLOW_DEV = args.get('allow-dev-build') === 'true';
export const OUT = args.get('out') ?? null;
export const SNAPSHOT = args.get('snapshot') ?? null;
export const DUPLICATIONS = Number(args.get('duplications') ?? 5);
export const FIXTURE = args.get('fixture') ?? null;
export const FIXTURE_DRAG = args.get('fixture-drag') ?? 'auto';
export const RENDERER_MODE = args.get('mode') ?? 'canvas2d-worker';
const RENDERER_MODES = new Set(['canvas2d-main', 'canvas2d-worker', 'webgl2']);
export const PREVIEW_QUALITY = args.get('quality') ?? 'automatic';
const PREVIEW_QUALITIES = new Set(['automatic', 'full']);
export const PREFLIGHT_ONLY = args.get('preflight-only') === 'true';
export const HEADLESS = args.get('headed') !== 'true';
export const DPR = Number(args.get('dpr') ?? 1);
export const VIEWPORT_WIDTH = Number(args.get('width') ?? 1600);
export const VIEWPORT_HEIGHT = Number(args.get('height') ?? 1000);
/**
 * Attach to an already-serving production build instead of building and
 * serving one. The dev-build signal check still runs against the served
 * artifact, so this cannot be used to smuggle a dev server in as production.
 */
export const EXTERNAL_BASE = args.get('base') ?? null;
export const WORKLOADS = (
  args.get('workloads') ??
  'pointer-move-idle,single-drag,multi-drag,marquee-select,pan,zoom,undo-redo'
).split(',');
export const MEASUREMENT_TRACE_KINDS = {
  'pointer-move-idle': ['hover'],
  'single-drag': ['pointer-drag'],
  'multi-drag': ['pointer-drag'],
  'marquee-select': ['pointer-drag'],
  pan: ['pointer-drag'],
  zoom: ['wheel', 'pinch'],
  brush: ['pointer-drag'],
  'brush-large-tip': ['pointer-drag'],
  eraser: ['pointer-drag'],
  'undo-redo': ['keyboard'],
  resize: ['pointer-drag'],
  rotate: ['pointer-drag'],
  'alt-drag': ['pointer-drag'],
  nudge: ['keyboard'],
  'tool-switch': ['keyboard'],
  'layer-visibility': ['pointer-drag'],
};

if (!RENDERER_MODES.has(RENDERER_MODE)) {
  fail(`unknown --mode '${RENDERER_MODE}'; use canvas2d-main, canvas2d-worker, or webgl2`);
}
if (!PREVIEW_QUALITIES.has(PREVIEW_QUALITY)) {
  fail(`unknown --quality '${PREVIEW_QUALITY}'; use automatic or full`);
}
if (!Number.isFinite(DPR) || DPR <= 0 || DPR > 4) fail('--dpr must be between 0 and 4');
if (!Number.isInteger(VIEWPORT_WIDTH) || VIEWPORT_WIDTH < 320 || VIEWPORT_WIDTH > 8192) {
  fail('--width must be an integer between 320 and 8192');
}
if (!Number.isInteger(VIEWPORT_HEIGHT) || VIEWPORT_HEIGHT < 240 || VIEWPORT_HEIGHT > 8192) {
  fail('--height must be an integer between 240 and 8192');
}

export function fail(message) {
  console.error(`\n  production-workload: ${message}\n`);
  process.exit(1);
}

export const DIST = `${ROOT}apps/desktop/dist`;
