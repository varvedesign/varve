import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Options } from '@wdio/globals/types';

const binaryName = process.platform === 'win32' ? 'varve-desktop.exe' : 'varve-desktop';
const appBinaryPath = process.env.VARVE_DESKTOP_BINARY
  ? resolve(process.env.VARVE_DESKTOP_BINARY)
  : resolve('apps/desktop/src-tauri/target/debug', binaryName);
const artifactDirectory = resolve('artifacts/desktop');
const defaultSpecs = ['./tests/wdio/tauri-smoke.e2e.ts', './tests/wdio/native-menu.e2e.ts'];
const specs = process.env.VARVE_WDIO_SPECS
  ? process.env.VARVE_WDIO_SPECS.split(',')
      .map((spec) => spec.trim())
      .filter(Boolean)
  : defaultSpecs;
const nativeFluidityCycles = Number(process.env.VARVE_NATIVE_FLUIDITY_CYCLES ?? 1);
const nativeFluidityTimeout =
  Number.isInteger(nativeFluidityCycles) && nativeFluidityCycles > 0
    ? Math.max(120_000, nativeFluidityCycles * 45_000)
    : 120_000;
// The OCR and colorize journeys drive real native models end to end (session
// open, inference, preview, apply, undo/redo) and declare their budget with
// this.timeout(); Mocha's config value clamps that per-spec call, so it must be
// at least as large as the largest native spec. Fluidity stays separately
// scalable because VARVE_NATIVE_FLUIDITY_CYCLES adds cycles to a single run.
const nativeModelTimeout = 480_000;
const nativeModelSpecs = ['./tests/wdio/colorize-native.e2e.ts', './tests/wdio/ocr-native.e2e.ts'];
const runsFluidityCycle = specs.some((spec) => spec.includes('native-fluidity-cycle'));
const runsNativeModelJourney = specs.some((spec) => nativeModelSpecs.includes(spec.trim()));
const timeout = runsFluidityCycle
  ? nativeFluidityTimeout
  : runsNativeModelJourney
    ? nativeModelTimeout
    : 90_000;

export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    tsNodeOpts: {
      project: './tsconfig.json',
    },
  },
  // Updater specs require the dedicated signed AppImage fixture runner. Keep
  // them out of the ordinary debug-binary lane; --spec still selects them
  // explicitly from scripts/update-test/run-slice.sh.
  specs,
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  logLevel: 'info',
  services: [
    [
      'tauri',
      {
        appBinaryPath,
        driverProvider: 'embedded',
      },
    ],
  ],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout,
  },
  reporters: ['spec'],
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  afterTest: async (_test, _context, { passed }) => {
    if (!passed) {
      mkdirSync(artifactDirectory, { recursive: true });
      await browser.saveScreenshot(join(artifactDirectory, `failed-${Date.now()}.png`));
    }
  },
};
