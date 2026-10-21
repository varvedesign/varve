import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLatestVersionClaims,
  inspectLine,
  isAiDefaultClaim,
  isVarveOpenSourceClaim,
} from './check-claims.mjs';
import { buildLlmsTxt } from './website/generate-llms-txt.mjs';

test('rejects Varve described as open source and allows the negation', () => {
  assert.equal(isVarveOpenSourceClaim('Varve is open source and free.'), true);
  assert.equal(
    isVarveOpenSourceClaim('Varve is source-available under FSL-1.1-MIT, not OSI-approved open source.'),
    false,
  );
  assert.equal(isVarveOpenSourceClaim('Is Varve open source?'), false);
  assert.equal(isVarveOpenSourceClaim('Icons come from open-source sets (Lucide).'), false);
});

test('rejects opt-in or optional only when the line is about AI', () => {
  assert.equal(isAiDefaultClaim('Visual search is opt-in and experimental'), true);
  assert.equal(isAiDefaultClaim('optional AI models you download later'), true);
  assert.equal(isAiDefaultClaim('AI-assisted operations are optional.'), true);
  assert.equal(isAiDefaultClaim('Line snapping is a separate, opt-in mode.'), false);
  assert.equal(isAiDefaultClaim('AI features are on by default and can be turned off in Settings.'), false);
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

test('inspectLine covers the banned product phrases', () => {
  const hits = inspectLine(
    'apps/website/src/pages/index.astro',
    'First-class desktop support with a Rust rendering engine and no telemetry.',
    '0.5.1',
    [],
  );
  assert.ok(hits.includes('Rust rendering engine'));
  assert.ok(hits.includes('no telemetry'));
  assert.deepEqual(
    inspectLine(
      'apps/website/src/pages/index.astro',
      'No design telemetry is included in consented measurements.',
      '0.5.1',
      [],
    ),
    [],
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
