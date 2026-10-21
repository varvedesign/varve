import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLatestVersionClaims,
  inspectLine,
  isAiDefaultClaim,
  isAiUsageNotTrackedClaim,
  isAllAiOffSwitchClaim,
  isBecomesFullyOpenSourceClaim,
  isBuiltInTheOpenClaim,
  isUsageNotMeasuredClaim,
  isVarveOpenSourceClaim,
} from './check-claims.mjs';
import { buildLlmsTxt } from './website/generate-llms-txt.mjs';

test('rejects Varve described as open source and allows the negation', () => {
  assert.equal(isVarveOpenSourceClaim('Varve is open source and free.'), true);
  assert.equal(
    isVarveOpenSourceClaim(
      'Varve is source-available under FSL-1.1-MIT, not OSI-approved open source.',
    ),
    false,
  );
  assert.equal(isVarveOpenSourceClaim('Is Varve open source?'), false);
  assert.equal(isVarveOpenSourceClaim('Icons come from open-source sets (Lucide).'), false);
});

test('rejects built in the open and becomes fully open-source', () => {
  assert.equal(isBuiltInTheOpenClaim('Varve is built in the open.'), true);
  assert.equal(isBuiltInTheOpenClaim('Source-available, developed on GitHub'), false);
  assert.equal(
    isBecomesFullyOpenSourceClaim(
      'the code converts to the MIT license and becomes fully open-source.',
    ),
    true,
  );
  assert.equal(isBecomesFullyOpenSourceClaim('the code becomes fully open source.'), true);
  assert.equal(
    isBecomesFullyOpenSourceClaim('that code is available under the MIT licence.'),
    false,
  );
});

test('rejects opt-in or optional only when the line is about AI', () => {
  assert.equal(isAiDefaultClaim('Visual search is opt-in and experimental'), true);
  assert.equal(isAiDefaultClaim('optional AI models you download later'), true);
  assert.equal(isAiDefaultClaim('AI-assisted operations are optional.'), true);
  assert.equal(isAiDefaultClaim('Line snapping is a separate, opt-in mode.'), false);
  assert.equal(
    isAiDefaultClaim('AI features are on by default and can be turned off in Settings.'),
    false,
  );
  assert.equal(
    isAiDefaultClaim('Native AI sessions prefer the optional ONNX Runtime WebGPU provider.'),
    false,
  );
});

test('latest-version claims ignore historical 0.5.0 mentions', () => {
  assert.deepEqual(
    findLatestVersionClaims('The latest published application release is Varve 0.5.0', '0.5.1'),
    ['0.5.0'],
  );
  assert.deepEqual(
    findLatestVersionClaims('At the 0.5.0 checkpoint that meant 1,903 browser tests.', '0.5.1'),
    [],
  );
  assert.deepEqual(
    findLatestVersionClaims('The latest published application release is Varve 0.5.1', '0.5.1'),
    [],
  );
});

test('rejects claims that AI feature use is never tracked', () => {
  assert.equal(
    isAiUsageNotTrackedClaim('Varve does not track which AI features you use or how often.'),
    true,
  );
  assert.equal(
    isAiUsageNotTrackedClaim(
      'Nothing is sent unless the user turns usage analytics on in Settings.',
    ),
    false,
  );
});

test('rejects one-switch-covers-all-AI wording', () => {
  assert.equal(isAllAiOffSwitchClaim('A single switch in Settings turns them all off.'), true);
  assert.equal(
    isAllAiOffSwitchClaim('AI features are on by default and can be turned off in Settings.'),
    false,
  );
});

test('rejects claims that usage is not measured', () => {
  assert.equal(isUsageNotMeasuredClaim("usage isn't measured"), true);
  assert.equal(isUsageNotMeasuredClaim("we don't measure usage"), true);
  assert.equal(isUsageNotMeasuredClaim('product usage are not measured'), true);
  assert.equal(isUsageNotMeasuredClaim('unique visitors are not measured'), false);
  assert.equal(isUsageNotMeasuredClaim('It is not measured Kelvin'), false);
});

test('inspectLine covers the banned product phrases', () => {
  const hits = inspectLine(
    'apps/website/src/pages/index.astro',
    'First-class desktop support with a Rust rendering engine, no telemetry, and usage is not measured.',
    '0.5.1',
    [],
  );
  assert.ok(hits.includes('Rust rendering engine'));
  assert.ok(hits.includes('no telemetry'));
  assert.ok(hits.includes("usage isn't measured"));
  assert.deepEqual(
    inspectLine(
      'apps/website/src/pages/index.astro',
      'No design telemetry is included in consented measurements.',
      '0.5.1',
      [],
    ),
    [],
  );
  assert.ok(
    inspectLine(
      'apps/website/src/pages/about.astro',
      'Built in the open so the code becomes fully open-source.',
      '0.5.1',
      [],
    ).includes('built in the open'),
  );
  assert.ok(
    inspectLine(
      'apps/website/src/pages/about.astro',
      'Built in the open so the code becomes fully open-source.',
      '0.5.1',
      [],
    ).includes('becomes fully open-source'),
  );
});

test('generated llms.txt stays factual for the current app version', () => {
  const text = buildLlmsTxt({
    version: '0.5.1',
    releaseDate: '2026-10-15',
    repoUrl: 'https://github.com/varvedesign/varve',
    releaseUrl: 'https://github.com/varvedesign/varve/releases/tag/v0.5.1',
  });
  assert.match(text, /Varve 0\.5\.1 \(2026-10-15\)/);
  assert.match(text, /github.com\/varvedesign\/varve/);
  assert.doesNotMatch(text, /Figma|Sketch|Illustrator|Affinity/);
  assert.match(text, /AI features are on by default/);
  assert.match(text, /exports PDF\/X-1a and PDF\/X-4|PDF\/X-1a and PDF\/X-4/);
});

test('allowlist skips a documented exception line', () => {
  const hits = inspectLine(
    'apps/website/src/pages/index.astro',
    'First-class desktop support with a Rust rendering engine.',
    '0.5.1',
    [
      {
        file: 'apps/website/src/pages/index.astro',
        includes: 'Rust rendering engine',
        reason: 'test exception',
      },
    ],
  );
  assert.equal(hits.includes('Rust rendering engine'), false);
});
