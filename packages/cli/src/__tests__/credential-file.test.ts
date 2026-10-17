/**
 * Reading the credential a record points at.
 *
 * An instance record is a file in a runtime directory, and the path it names is
 * read and then sent to a socket as the credential. The application's own side
 * refuses anything but a plain, owner-only file (`read_secret`); the client must
 * not be the weaker half.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCredentialFile } from '../control/instance';

const made: string[] = [];
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'varve-cred-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function secret(dir: string, name = 'token', mode = 0o600): string {
  const path = join(dir, name);
  writeFileSync(path, 'abc123\n', { mode });
  chmodSync(path, mode);
  return path;
}

describe('readCredentialFile', () => {
  it('reads a plain owner-only file and trims it', () => {
    const dir = sandbox();
    expect(readCredentialFile(secret(dir))).toBe('abc123');
  });

  it('refuses a file other users can read', () => {
    const dir = sandbox();
    expect(() => readCredentialFile(secret(dir, 'token', 0o644))).toThrow(
      /readable by other users/,
    );
  });

  it('refuses a symlink, even to a good file', () => {
    const dir = sandbox();
    const real = secret(dir, 'real');
    const link = join(dir, 'link');
    symlinkSync(real, link);
    expect(() => readCredentialFile(link)).toThrow(/not a plain file/);
  });

  it('refuses a directory', () => {
    const dir = sandbox();
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    expect(() => readCredentialFile(sub)).toThrow(/not a plain file/);
  });

  it('refuses a file that is not in the directory the record lives in', () => {
    // A record can name any path. Only the credential beside it is the
    // application's; anything else would be read and sent as if it were.
    const instanceDir = sandbox();
    const elsewhere = sandbox();
    const outside = secret(elsewhere, 'id_ed25519');
    expect(() => readCredentialFile(outside, { insideDir: instanceDir })).toThrow(
      /not inside the instance directory/,
    );
    expect(readCredentialFile(secret(instanceDir), { insideDir: instanceDir })).toBe('abc123');
  });

  it('refuses a name that climbs out of the instance directory', () => {
    const instanceDir = sandbox();
    const sibling = sandbox();
    secret(sibling, 'token');
    const sneaky = join(instanceDir, '..', sibling.split('/').pop() as string, 'token');
    expect(() => readCredentialFile(sneaky, { insideDir: instanceDir })).toThrow(
      /not inside the instance directory/,
    );
  });
});
