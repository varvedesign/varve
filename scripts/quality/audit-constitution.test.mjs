#!/usr/bin/env node
/** Regression tests for the constitution audit: a rule must map to real
 * enforcement, roles must reference real files/scripts, and the CLI contract
 * holds. Every case runs against a throwaway fixture tree, never the repo's
 * own constitution. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkConstitution, reachableDocs } from './audit-constitution.mjs';

const SCRIPT = fileURLToPath(new URL('./audit-constitution.mjs', import.meta.url));

function baseConstitution() {
  return {
    schema: 'agent-constitution-v1',
    version: 1,
    repo: 'varve',
    description: 'Machine-validated rules; AGENTS.md is the always-loaded prompt for agents.',
    roles: [
      {
        id: 'editor-ui',
        file: '.ai/roles/editor-ui-engineer.md',
        applies_to: ['.ai/roles'],
        required_checks: ['check:agent', 'lint'],
      },
      {
        id: 'rust-ipc',
        file: '.ai/roles/rust-ipc-engineer.md',
        applies_to: ['.ai/roles'],
        required_checks: ['check:agent'],
      },
    ],
    rules: [
      {
        id: 'CON-001',
        title: 'No emoji',
        statement: 'Source, docs and UI strings contain no emoji characters at all.',
        severity: 'blocking',
        source: 'docs/guide.md',
        enforcement: { kind: 'command', value: 'audit:emoji' },
      },
      {
        id: 'CON-002',
        title: 'Architecture ceilings',
        statement: 'Hub import budgets and complexity ceilings are enforced by the health audit.',
        severity: 'blocking',
        source: 'docs/guide.md#ceilings',
        enforcement: { kind: 'script', value: 'scripts/audit-health.mjs' },
      },
      {
        id: 'CON-003',
        title: 'Control vocabulary',
        statement: 'Button and control vocabulary is closed and checked by system tests.',
        severity: 'blocking',
        source: 'docs/guide.md',
        enforcement: { kind: 'test', paths: ['tests/unit/button.test.ts'] },
      },
      {
        id: 'CON-004',
        title: 'Manual render review',
        statement: 'Pixel reuse changes are proven with the full-redraw hash oracle.',
        severity: 'advisory',
        source: 'docs/guide.md',
        enforcement: {
          kind: 'manual',
          checklist: [
            'Hash the surface after the interaction at the same camera.',
            'Force a full redraw and compare the hash before accepting the change.',
          ],
          review_doc: 'docs/guide.md',
        },
      },
    ],
  };
}

function makeFixture(constitution) {
  const root = mkdtempSync(join(tmpdir(), 'constitution-test-'));
  const files = {
    'AGENTS.md': '# Agents\n\nStart with [the guide](docs/guide.md).\n',
    'package.json': JSON.stringify({
      scripts: { 'check:agent': 'x', lint: 'x', 'audit:emoji': 'x' },
    }),
    'docs/guide.md': '# guide\n',
    '.ai/roles/editor-ui-engineer.md': '# Role: editor-ui\n',
    '.ai/roles/rust-ipc-engineer.md': '# Role: rust-ipc\n',
    'scripts/audit-health.mjs': '// fixture\n',
    'tests/unit/button.test.ts': '// fixture\n',
  };
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  writeFileSync(join(root, '.ai/constitution.json'), JSON.stringify(constitution, null, 2));
  return root;
}

function withFixture(constitution, body) {
  const root = makeFixture(constitution);
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function run(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('a valid constitution passes and reports stats', () => {
  withFixture(baseConstitution(), (root) => {
    const result = checkConstitution({ root });
    assert.deepEqual(result.findings, []);
    assert.equal(result.stats.roles, 2);
    assert.equal(result.stats.rules, 4);
    assert.equal(result.stats.enforced, 3);
    assert.equal(result.stats.manual, 1);
  });
});

const RULE_MUTATIONS = [
  [
    'schema mismatch',
    (constitution) => {
      constitution.schema = 'other';
    },
    /schema must be/,
  ],
  [
    'version mismatch',
    (constitution) => {
      constitution.version = 2;
    },
    /version must be 1/,
  ],
  [
    'repo mismatch',
    (constitution) => {
      constitution.repo = 'hutch';
    },
    /repo must be/,
  ],
  [
    'duplicate rule id',
    (constitution) => {
      constitution.rules[1].id = 'CON-001';
    },
    /duplicate id/,
  ],
  [
    'bad rule id',
    (constitution) => {
      constitution.rules[0].id = 'RULE-1';
    },
    /id must match CON-/,
  ],
  [
    'bad severity',
    (constitution) => {
      constitution.rules[0].severity = 'urgent';
    },
    /severity must be/,
  ],
  [
    'missing title',
    (constitution) => {
      delete constitution.rules[0].title;
    },
    /title is missing/,
  ],
  [
    'unknown command',
    (constitution) => {
      constitution.rules[0].enforcement.value = 'audit:nope';
    },
    /not a package.json script/,
  ],
  [
    'missing script',
    (constitution) => {
      constitution.rules[1].enforcement.value = 'scripts/nope.mjs';
    },
    /script .* does not exist/,
  ],
  [
    'missing test path',
    (constitution) => {
      constitution.rules[2].enforcement.paths = ['tests/unit/nope.test.ts'];
    },
    /test path .* does not exist/,
  ],
  [
    'short manual checklist',
    (constitution) => {
      constitution.rules[3].enforcement.checklist = ['one'];
    },
    /manual enforcement needs/,
  ],
  [
    'missing review doc',
    (constitution) => {
      constitution.rules[3].enforcement.review_doc = 'docs/nope.md';
    },
    /review_doc .* does not exist/,
  ],
  [
    'missing source doc',
    (constitution) => {
      constitution.rules[0].source = 'docs/nope.md#x';
    },
    /source doc .* does not exist/,
  ],
  [
    'missing role file',
    (constitution) => {
      constitution.roles[0].file = '.ai/roles/nope.md';
    },
    /file .* does not exist/,
  ],
  [
    'missing applies_to path',
    (constitution) => {
      constitution.roles[0].applies_to = ['nope/'];
    },
    /applies_to .* does not exist/,
  ],
  [
    'unknown required check',
    (constitution) => {
      constitution.roles[0].required_checks = ['nope:script'];
    },
    /required check .* is not a package.json script/,
  ],
];

for (const [name, mutate, expected] of RULE_MUTATIONS) {
  test(`fails on ${name}`, () => {
    const constitution = baseConstitution();
    mutate(constitution);
    withFixture(constitution, (root) => {
      const result = checkConstitution({ root });
      assert.ok(
        result.findings.some((finding) => expected.test(finding)),
        `expected ${expected} in ${JSON.stringify(result.findings)}`,
      );
    });
  });
}

test('orphan role files are reported', () => {
  withFixture(baseConstitution(), (root) => {
    writeFileSync(join(root, '.ai/roles/orphan.md'), '# orphan\n');
    const findings = checkConstitution({ root }).findings;
    assert.ok(
      findings.some((finding) => /orphan\.md: role file is not registered/.test(finding)),
      JSON.stringify(findings),
    );
  });
});

test('duplicate role registrations are reported', () => {
  const constitution = baseConstitution();
  constitution.roles[1].file = '.ai\\roles\\editor-ui-engineer.md';
  withFixture(constitution, (root) => {
    const findings = checkConstitution({ root }).findings;
    assert.ok(
      findings.some((finding) => /registered by 2 roles/.test(finding)),
      JSON.stringify(findings),
    );
    assert.ok(
      findings.some((finding) =>
        /rust-ipc-engineer\.md: role file is not registered/.test(finding),
      ),
      JSON.stringify(findings),
    );
  });
});

test('unreachable rule source docs are reported', () => {
  const constitution = baseConstitution();
  constitution.rules[0].source = 'docs/detached.md';
  withFixture(constitution, (root) => {
    writeFileSync(join(root, 'docs/detached.md'), '# detached\n');
    const findings = checkConstitution({ root }).findings;
    assert.ok(
      findings.some((finding) =>
        /docs\/detached\.md.*is not reachable from AGENTS\.md/.test(finding),
      ),
      JSON.stringify(findings),
    );
  });
});

test('rule sources reachable at depth 2 pass', () => {
  const constitution = baseConstitution();
  constitution.rules[0].source = 'docs/deep.md';
  withFixture(constitution, (root) => {
    writeFileSync(join(root, 'docs/guide.md'), '# guide\n\nSee [deep](deep.md).\n');
    writeFileSync(join(root, 'docs/deep.md'), '# deep\n');
    assert.deepEqual(checkConstitution({ root }).findings, []);
  });
});

test('backticked repo-relative doc paths count as links', () => {
  withFixture(baseConstitution(), (root) => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# Agents\n\nStart with [the guide](docs/guide.md), then load `docs/backtick.md`.\n',
    );
    writeFileSync(join(root, 'docs/backtick.md'), '# backtick\n');
    assert.ok(reachableDocs(root).has('docs/backtick.md'));
  });
});

test('reachability ignores external links, mailto and anchors', () => {
  withFixture(baseConstitution(), (root) => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# Agents\n\n[ext](https://example.com/docs/guide.md) [mail](mailto:a@b.co) [self](#top)\n',
    );
    const findings = checkConstitution({ root }).findings;
    assert.ok(
      findings.some((finding) => /docs\/guide\.md.*is not reachable/.test(finding)),
      JSON.stringify(findings),
    );
  });
});

test('missing AGENTS.md is one clear finding', () => {
  withFixture(baseConstitution(), (root) => {
    rmSync(join(root, 'AGENTS.md'));
    const result = checkConstitution({ root });
    assert.equal(result.findings.length, 1, JSON.stringify(result.findings));
    assert.match(result.findings[0], /AGENTS\.md: missing/);
  });
});

test('malformed JSON is reported without throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'constitution-test-'));
  try {
    mkdirSync(join(root, '.ai'), { recursive: true });
    writeFileSync(join(root, '.ai/constitution.json'), '{');
    const result = checkConstitution({ root });
    assert.match(result.findings[0], /unreadable or invalid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI contract: valid passes, --json works, invalid fails, unknown args fail', () => {
  withFixture(baseConstitution(), (root) => {
    const clean = run(root);
    assert.equal(clean.status, 0, clean.output);
    assert.match(clean.output, /Constitution OK/);

    const json = run(root, ['--json']);
    assert.equal(json.status, 0, json.output);
    const parsed = JSON.parse(json.output);
    assert.equal(parsed.ok, true);

    const help = run(root, ['--help']);
    assert.equal(help.status, 0, help.output);

    const unknown = run(root, ['--bogus']);
    assert.equal(unknown.status, 2, unknown.output);
  });

  const invalid = baseConstitution();
  invalid.version = 9;
  withFixture(invalid, (root) => {
    const result = run(root);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Constitution FAILED/);
  });
});
