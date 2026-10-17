/**
 * Where a client looks for the application's endpoints.
 *
 * The desktop application (Rust) and this CLI each decide the runtime directory
 * for themselves, and discovery only works when they decide the same thing. The
 * rule is written down on the Rust side, and this is its twin:
 *
 *   $VARVE_RUNTIME_DIR, then $XDG_RUNTIME_DIR/varve, then <home>/.varve/run
 *
 * `/tmp` is never a fallback: any user can create a directory there, and a
 * runtime directory the owner does not control can read the credential.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeDirectory } from '../control/instance';

const made: string[] = [];
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'varve-runtime-home-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runtimeDirectory', () => {
  it('prefers an explicit VARVE_RUNTIME_DIR', () => {
    const base = join(home(), 'explicit');
    expect(runtimeDirectory({ VARVE_RUNTIME_DIR: base, XDG_RUNTIME_DIR: '/run/user/1' })).toBe(
      base,
    );
  });

  it('uses XDG_RUNTIME_DIR/varve when it is absolute', () => {
    const xdg = home();
    expect(runtimeDirectory({ XDG_RUNTIME_DIR: xdg })).toBe(join(xdg, 'varve'));
  });

  it('falls back to <home>/.varve/run, the same place the application uses', () => {
    // macOS has no XDG_RUNTIME_DIR; neither does a minimal Linux session. The
    // application falls back to the home directory there, so the CLI must too or
    // `varve instances` looks in one place while the window writes to another.
    const h = home();
    const dir = runtimeDirectory({ HOME: h });
    expect(dir).toBe(join(h, '.varve', 'run'));
    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it('ignores a relative XDG_RUNTIME_DIR, as the application does', () => {
    const h = home();
    expect(runtimeDirectory({ XDG_RUNTIME_DIR: 'relative/dir', HOME: h })).toBe(
      join(h, '.varve', 'run'),
    );
  });

  it('uses USERPROFILE when HOME is absent', () => {
    const h = home();
    expect(runtimeDirectory({ USERPROFILE: h })).toBe(join(h, '.varve', 'run'));
  });

  it('refuses to guess a shared location when nothing identifies a user', () => {
    expect(() => runtimeDirectory({})).toThrow(/VARVE_RUNTIME_DIR/);
  });
});
