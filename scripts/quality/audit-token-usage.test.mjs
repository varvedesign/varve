#!/usr/bin/env node

/** Regression tests for the token-usage audit's definition collection. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./audit-token-usage.mjs', import.meta.url));

function runFixture(files, { underWorktrees = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'token-usage-'));
  const root = underWorktrees ? join(base, '.worktrees', 'feature') : base;
  try {
    const dir = join(root, 'packages', 'demo', 'src');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(root, 'apps'), { recursive: true });
    // Bare names land in packages/demo/src; paths with a slash are relative
    // to the fixture root (for bundle-scoping cases).
    for (const [name, content] of Object.entries(files)) {
      const target = name.includes('/') ? join(root, name) : join(dir, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    try {
      const stdout = execFileSync(process.execPath, [scriptPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// The definition scan must ignore comment lines exactly like the reference
// scan does. Before this parity, documenting `--foo:` in a comment satisfied
// every `var(--foo)` reference and the gate was vacuous for hand-typed names.
const commentedOnly = runFixture({
  'demo.css': '.demo { color: var(--ghost-token); }\n',
  'defs.ts': "// --ghost-token: red;\nexport const note = 'documented, not defined';\n",
});
assert.notEqual(commentedOnly.status, 0, 'a comment-only definition must not satisfy a reference');
assert.match(commentedOnly.stdout, /--ghost-token/);

// A real stylesheet definition satisfies the reference.
const reallyDefined = runFixture({
  'demo.css': ':root { --real-token: #123456; }\n.demo { color: var(--real-token); }\n',
});
assert.equal(reallyDefined.status, 0, `expected clean run, got:\n${reallyDefined.stdout}`);

// A runtime publisher that assigns the name to a constant
// (`FOO_PROPERTY = '--foo'` then `setProperty(FOO_PROPERTY, …)`) counts.
const constantDefined = runFixture({
  'demo.css': '.demo { height: var(--published-height); }\n',
  'publisher.ts': "export const PUBLISHED_HEIGHT = '--published-height';\n",
});
assert.equal(
  constantDefined.status,
  0,
  `a constant-assigned token name must count as defined, got:\n${constantDefined.stdout}`,
);

// A literal fallback attached to a defined token stays fatal.
const literalFallback = runFixture({
  'demo.css':
    ':root { --skinned-token: #123456; }\n.demo { color: var(--skinned-token, #654321); }\n',
});
assert.notEqual(literalFallback.status, 0, 'a literal fallback on a defined token must fail');
assert.match(literalFallback.stdout, /--skinned-token/);

// A name only the website defines does not exist in the app bundle (F-47:
// the first-run guide and two browsers styled themselves with website-only
// aliases and rendered unthemed in the app).
const websiteOnly = runFixture({
  'apps/website/src/styles/theme.css': ':root { --site-only: #123456; }\n',
  'demo.css': '.demo { color: var(--site-only); }\n',
});
assert.notEqual(websiteOnly.status, 0, 'an app reference to a website-only token must fail');
assert.match(websiteOnly.stdout, /--site-only/);

// The website itself may use its own layer and the shared app tokens.
const websiteUsesBoth = runFixture({
  'apps/website/src/styles/theme.css':
    ':root { --site-only: #123456; }\n.hero { color: var(--site-only); background: var(--shared-token); }\n',
  'tokens.css': ':root { --shared-token: #abcdef; }\n',
});
assert.equal(
  websiteUsesBoth.status,
  0,
  `website scope must see both, got:\n${websiteUsesBoth.stdout}`,
);

// A checkout under `.worktrees/` is still scanned: the skip pattern used to
// match the absolute path, so every worktree run was vacuously clean.
const inWorktree = runFixture(
  { 'demo.css': '.demo { color: var(--ghost-token); }\n' },
  { underWorktrees: true },
);
assert.notEqual(inWorktree.status, 0, 'a worktree checkout must still be audited');
assert.match(inWorktree.stdout, /--ghost-token/);

console.log('audit-token-usage.test.mjs — 9 assertions passed');
