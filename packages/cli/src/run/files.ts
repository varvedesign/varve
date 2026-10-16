/**
 * File boundary for the headless CLI and MCP bridge.
 *
 * Everything that reads or writes a path goes through here. Policy is applied
 * to the canonical (symlink-resolved) path, with a path-relation test and not a
 * string-prefix test, and writes are atomic, lock-protected and
 * compare-and-swap against the content that was loaded. This is the only place
 * a document file is replaced, so the invariants live in one place:
 *
 * - never write through a symlink or over a hard-linked alias;
 * - never replace a file unless the caller said to (`overwrite`) or the bytes
 *   on disk are still the ones that were loaded (`expectedHash`);
 * - never leave a half-written file: temp file, fsync, rename;
 * - never delete someone else's lock.
 *
 * Limits, stated honestly: the check-then-rename sequence is atomic only with
 * respect to cooperating writers that honor the lock file, and case-insensitive
 * file systems are handled through `realpath.native` casing, not by modelling
 * every volume's rules.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type FileErrorCode =
  | 'READ_FAILED'
  | 'TOO_LARGE'
  | 'NOT_ALLOWED'
  | 'INVALID_PATH'
  | 'EXISTS'
  | 'CHANGED_ON_DISK'
  | 'LOCKED'
  | 'IS_SYMLINK'
  | 'HARDLINKED'
  | 'WRITE_FAILED';

export class FileError extends Error {
  constructor(
    readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FileError';
  }
}

export function sha256File(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── Path policy ─────────────────────────────────────────────────────────────

export interface PathPolicyOptions {
  /** When set, reads must resolve inside one of these directories. */
  readRoots?: readonly string[];
  /** When set, writes must resolve inside one of these directories. */
  writeRoots?: readonly string[];
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function nativeRealpath(path: string): string {
  return realpathSync.native(path);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

export class PathPolicy {
  private readonly readRoots: string[] | undefined;
  private readonly writeRoots: string[] | undefined;

  constructor(options: PathPolicyOptions = {}) {
    const canon = (roots: readonly string[] | undefined): string[] | undefined =>
      roots && roots.length > 0
        ? roots.map((root) => {
            try {
              return nativeRealpath(resolve(root));
            } catch {
              throw new FileError('INVALID_PATH', `policy root does not exist: ${root}`);
            }
          })
        : undefined;
    this.readRoots = canon(options.readRoots);
    this.writeRoots = canon(options.writeRoots);
  }

  /** Roots from `VARVE_READ_ROOTS` / `VARVE_WRITE_ROOTS` (path-delimiter separated). */
  static fromEnv(
    env: Record<string, string | undefined>,
    extra: PathPolicyOptions = {},
  ): PathPolicy {
    const split = (value: string | undefined): string[] =>
      value ? value.split(delimiter).filter(Boolean) : [];
    return new PathPolicy({
      readRoots: [...split(env.VARVE_READ_ROOTS), ...(extra.readRoots ?? [])],
      writeRoots: [...split(env.VARVE_WRITE_ROOTS), ...(extra.writeRoots ?? [])],
    });
  }

  get restricted(): boolean {
    return this.readRoots !== undefined || this.writeRoots !== undefined;
  }

  describe(): { readRoots: string[] | null; writeRoots: string[] | null } {
    return { readRoots: this.readRoots ?? null, writeRoots: this.writeRoots ?? null };
  }

  /** Canonical path of an existing file for reading. */
  resolveRead(path: string): string {
    assertPlausible(path);
    let canonical: string;
    try {
      canonical = nativeRealpath(resolve(path));
    } catch (error) {
      throw new FileError('READ_FAILED', `cannot read ${path}: ${reason(error)}`);
    }
    if (this.readRoots && !this.readRoots.some((root) => isInside(root, canonical))) {
      throw new FileError('NOT_ALLOWED', `reading ${path} is outside the permitted read roots`);
    }
    return canonical;
  }

  /**
   * Canonical path for a file that may not exist yet. The parent directory
   * must exist and is resolved through symlinks; the final component is kept.
   */
  resolveWrite(path: string): string {
    assertPlausible(path);
    const absolute = resolve(path);
    const parent = dirname(absolute);
    let canonicalParent: string;
    try {
      canonicalParent = nativeRealpath(parent);
    } catch (error) {
      throw new FileError('INVALID_PATH', `directory does not exist for ${path}: ${reason(error)}`);
    }
    const leaf = basename(absolute);
    if (leaf === '' || leaf === '.' || leaf === '..') {
      throw new FileError('INVALID_PATH', `not a file path: ${path}`);
    }
    const target = join(canonicalParent, leaf);
    if (this.writeRoots && !this.writeRoots.some((root) => isInside(root, target))) {
      throw new FileError('NOT_ALLOWED', `writing ${path} is outside the permitted write roots`);
    }
    return target;
  }
}

function assertPlausible(path: string): void {
  if (path.length === 0 || path.includes('\0')) {
    throw new FileError('INVALID_PATH', 'path is empty or contains a NUL byte');
  }
  if (process.platform === 'win32') {
    if (/^\\\\[?.]\\/.test(path) || WINDOWS_DEVICE.test(basename(path))) {
      throw new FileError('INVALID_PATH', `device and namespace paths are not accepted: ${path}`);
    }
  }
}

function reason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}` : error.message;
  }
  return String(error);
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface LoadedText {
  /** Canonical path that was read. */
  path: string;
  text: string;
  bytes: number;
  contentHash: string;
}

export function readTextFile(canonicalPath: string, maxBytes: number): LoadedText {
  let fd: number | undefined;
  try {
    fd = openSync(canonicalPath, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile())
      throw new FileError('READ_FAILED', `${canonicalPath} is not a regular file`);
    if (stat.size > maxBytes) {
      throw new FileError(
        'TOO_LARGE',
        `${canonicalPath} is ${stat.size} bytes; the limit is ${maxBytes}`,
      );
    }
    const buffer = readFileSync(fd);
    return {
      path: canonicalPath,
      text: buffer.toString('utf8'),
      bytes: buffer.byteLength,
      contentHash: sha256File(buffer),
    };
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError('READ_FAILED', `cannot read ${canonicalPath}: ${reason(error)}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ── Locking ─────────────────────────────────────────────────────────────────

export interface FileLock {
  path: string;
  release(): void;
}

/**
 * Cooperative advisory lock beside the target. An existing lock is never
 * removed: if its owner crashed, a person decides, because deleting a live
 * lock is how two writers corrupt one document.
 */
export function acquireLock(targetPath: string): FileLock {
  const lockPath = `${targetPath}.varve-lock`;
  const token = randomBytes(8).toString('hex');
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      let owner = 'another process';
      try {
        const info = JSON.parse(readFileSync(lockPath, 'utf8')) as {
          pid?: number;
          host?: string;
          tool?: string;
          startedAt?: string;
        };
        owner = `${info.tool ?? 'a Varve writer'} (pid ${info.pid ?? '?'} on ${info.host ?? '?'}, since ${info.startedAt ?? '?'})`;
      } catch {
        // unreadable lock: report the path only
      }
      throw new FileError(
        'LOCKED',
        `${targetPath} is locked by ${owner}; if that process is gone, remove ${lockPath} yourself`,
      );
    }
    throw new FileError('WRITE_FAILED', `cannot create lock ${lockPath}: ${reason(error)}`);
  }
  try {
    writeSync(
      fd,
      JSON.stringify({
        token,
        pid: process.pid,
        host: hostname(),
        tool: 'varve-cli',
        startedAt: new Date().toISOString(),
      }),
    );
  } finally {
    closeSync(fd);
  }
  return {
    path: lockPath,
    release() {
      try {
        const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: string };
        if (current.token === token) unlinkSync(lockPath);
      } catch {
        // already gone
      }
    },
  };
}

// ── Atomic writing ──────────────────────────────────────────────────────────

export type WriteMode =
  /** Fail if the target exists; never clobber (atomic via hard link). */
  | { kind: 'create-new' }
  /** Replace an existing file whose bytes are still `expectedHash`. */
  | { kind: 'replace-expected'; expectedHash: string }
  /** Replace whatever is there (the caller passed an explicit overwrite flag). */
  | { kind: 'replace-any' };

export interface SaveResult {
  path: string;
  bytes: number;
  contentHash: string;
}

export function writeTextAtomic(
  policy: PathPolicy,
  requestedPath: string,
  text: string,
  mode: WriteMode,
): SaveResult {
  const target = policy.resolveWrite(requestedPath);
  const data = Buffer.from(text, 'utf8');
  const hash = sha256File(data);

  let existing: ReturnType<typeof lstatSync> | null = null;
  try {
    existing = lstatSync(target);
  } catch {
    existing = null;
  }
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new FileError(
        'IS_SYMLINK',
        `${target} is a symbolic link; refusing to write through it`,
      );
    }
    if (!existing.isFile()) throw new FileError('INVALID_PATH', `${target} is not a regular file`);
    if (mode.kind === 'create-new') {
      throw new FileError('EXISTS', `${target} already exists; pass --overwrite to replace it`);
    }
    if (existing.nlink > 1) {
      throw new FileError(
        'HARDLINKED',
        `${target} has ${existing.nlink} hard links; replacing it would silently detach or alter an alias`,
      );
    }
    if (mode.kind === 'replace-expected') {
      const onDisk = sha256File(readFileSync(target));
      if (onDisk !== mode.expectedHash) {
        throw new FileError(
          'CHANGED_ON_DISK',
          `${target} changed since it was read; re-run against the current file instead of overwriting newer work`,
        );
      }
    }
  } else if (mode.kind === 'replace-expected') {
    throw new FileError('CHANGED_ON_DISK', `${target} no longer exists`);
  }

  const dir = dirname(target);
  const temp = join(
    dir,
    `.${basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = openSync(temp, 'wx', existing ? existing.mode & 0o777 : 0o644);
    writeSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    if (mode.kind === 'create-new') {
      try {
        linkSync(temp, target); // fails with EEXIST rather than replacing
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new FileError('EXISTS', `${target} already exists; pass --overwrite to replace it`);
        }
        // Some file systems have no hard links: fall back to check + rename.
        if (existsSync(target)) {
          throw new FileError('EXISTS', `${target} already exists; pass --overwrite to replace it`);
        }
        renameSync(temp, target);
        return { path: target, bytes: data.byteLength, contentHash: hash };
      }
      unlinkSync(temp);
    } else {
      if (mode.kind === 'replace-expected') {
        const onDisk = sha256File(readFileSync(target));
        if (onDisk !== mode.expectedHash) {
          throw new FileError('CHANGED_ON_DISK', `${target} changed while it was being saved`);
        }
      }
      renameSync(temp, target);
    }
    syncDirectory(dir);
    return { path: target, bytes: data.byteLength, contentHash: hash };
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      unlinkSync(temp);
    } catch {
      // ignore: temp may already have been renamed or never created
    }
    if (error instanceof FileError) throw error;
    throw new FileError('WRITE_FAILED', `cannot write ${target}: ${reason(error)}`);
  }
}

function syncDirectory(dir: string): void {
  if (process.platform === 'win32') return;
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // best effort: durability of the directory entry is not available everywhere
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function ensureDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  if (!statSync(path).isDirectory())
    throw new FileError('INVALID_PATH', `${path} is not a directory`);
}
