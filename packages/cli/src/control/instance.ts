/**
 * Instance directory and discovery for control endpoints.
 *
 * Layout (Unix): `<runtime>/v-<id>/` mode 0700 holding the socket `s`, the
 * credential file `token` (0600) and `instance.json`. The directory permission
 * is the kernel-enforced access control for the socket; the token is a second
 * factor that also protects transports where filesystem modes do not apply
 * (named pipes, loopback TCP). `instance.json` identifies the endpoint (app,
 * version, document, pid) and deliberately contains no credential, so listing
 * instances is safe to show or log.
 */
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const INSTANCE_SCHEMA = 'varve.instance/1';

export interface InstanceRecord {
  schema: typeof INSTANCE_SCHEMA;
  instanceId: string;
  mode: 'headless' | 'connected';
  pid: number;
  startedAt: string;
  app: { name: string; version: string };
  protocol: string;
  /** Unix socket path or Windows named-pipe name. */
  endpoint: string;
  /** Path of the credential file. The credential itself is never listed. */
  tokenFile: string;
  document: { id: string; name: string };
}

function uid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

/**
 * The per-user runtime directory, created with owner-only permissions.
 *
 * `$VARVE_RUNTIME_DIR`, then `$XDG_RUNTIME_DIR/varve`, then `<home>/.varve/run`.
 * This is a contract with the desktop application, which decides the same thing
 * in Rust (`runtime_directory` in `varve-automation-host`): discovery only works
 * when both sides look in the same place, and a fallback that differs shows up
 * as "no instances" on exactly the platforms that have no XDG_RUNTIME_DIR.
 *
 * A shared temporary directory is never the fallback. Any user can create a
 * directory there, and a runtime directory its owner does not control is one
 * that can read the credential.
 */
export function runtimeDirectory(env: Record<string, string | undefined>): string {
  const explicit = env.VARVE_RUNTIME_DIR;
  const xdg = env.XDG_RUNTIME_DIR;
  const base =
    explicit && explicit.length > 0
      ? explicit
      : xdg?.startsWith('/')
        ? join(xdg, 'varve')
        : join(homeDirectory(env), '.varve', 'run');
  ensurePrivateDirectory(base);
  return base;
}

function homeDirectory(env: Record<string, string | undefined>): string {
  for (const key of ['HOME', 'USERPROFILE'] as const) {
    const value = env[key];
    if (value && value.length > 0) return value;
  }
  throw new Error(
    'no HOME or USERPROFILE; set VARVE_RUNTIME_DIR to choose a runtime directory explicitly',
  );
}

/** Create (or verify) a directory only the current user can enter. */
export function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${path} is not a plain directory; refusing to use it for control endpoints`);
  }
  if (process.platform !== 'win32') {
    const owner = uid();
    if (owner !== null && stat.uid !== owner) {
      throw new Error(`${path} is owned by another user; refusing to use it`);
    }
    if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o700);
  }
}

/**
 * Read a credential file, refusing anything but a plain, owner-only file.
 *
 * This is the client's half of a rule the application already enforces on its
 * side (`read_secret`): the path may come from an instance record, the contents
 * are sent to a socket as the credential, and a client that reads whatever the
 * path names would hand over any file a record pointed at, through a symlink or
 * a path that climbs out of the instance directory.
 *
 * When `insideDir` is given (the path came from a record), the file must sit
 * directly in that record's own directory. An explicit path the person typed is
 * theirs to choose and is held to the file checks only.
 */
export function readCredentialFile(path: string, options: { insideDir?: string } = {}): string {
  if (options.insideDir !== undefined && dirname(resolve(path)) !== resolve(options.insideDir)) {
    throw new Error(`${path} is not inside the instance directory ${options.insideDir}`);
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${path} is not a plain file`);
  }
  if (process.platform !== 'win32') {
    const owner = uid();
    if (owner !== null && stat.uid !== owner) {
      throw new Error(`${path} is owned by another user`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`${path} is readable by other users; run "chmod 600" on it`);
    }
  }
  return readFileSync(path, 'utf8').trim();
}

export interface CreatedInstance {
  dir: string;
  endpoint: string;
  tokenFile: string;
  token: string;
  recordPath: string;
}

export function createInstanceDirectory(
  env: Record<string, string | undefined>,
  instanceId: string,
): CreatedInstance {
  const base = runtimeDirectory(env);
  const short =
    instanceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || randomBytes(4).toString('hex');

  // The name carries a random suffix, and an existing directory is never
  // removed.
  //
  // The earlier scheme was `v-<first eight alphanumerics of the instance id>`,
  // which is a constant for every headless session: their ids all begin
  // "headless-", so two concurrent sessions mapped to the same path and the
  // second one deleted the first one's socket, credential and record. The first
  // server kept serving clients that were already connected while being
  // undiscoverable and unverifiable to everyone else.
  //
  // A unique name makes a collision a bug rather than a stale leftover, so
  // refusing is correct and deleting is not. The prefix stays `v-` because
  // discovery is defined as "every `v-*` directory with a readable record".
  let dir = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = join(base, `v-${short}-${randomBytes(4).toString('hex')}`);
    if (!existsSync(candidate)) {
      dir = candidate;
      break;
    }
  }
  if (dir === '') {
    throw new Error(`could not find an unused instance directory under ${base}`);
  }
  mkdirSync(dir, { mode: 0o700 });
  ensurePrivateDirectory(dir);
  const token = randomBytes(32).toString('hex');
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\varve-${short}-${randomBytes(4).toString('hex')}`
      : join(dir, 's');
  return { dir, endpoint, tokenFile, token, recordPath: join(dir, 'instance.json') };
}

export function writeInstanceRecord(path: string, record: InstanceRecord): void {
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface DiscoveredInstance {
  record: InstanceRecord;
  dir: string;
  alive: boolean;
}

/** Instances recorded under the runtime directory, with liveness of the pid. */
export function discoverInstances(env: Record<string, string | undefined>): DiscoveredInstance[] {
  let base: string;
  try {
    base = runtimeDirectory(env);
  } catch {
    return [];
  }
  const found: DiscoveredInstance[] = [];
  for (const name of readdirSync(base)) {
    if (!name.startsWith('v-')) continue;
    const dir = join(base, name);
    try {
      const record = JSON.parse(readFileSync(join(dir, 'instance.json'), 'utf8')) as InstanceRecord;
      if (record.schema !== INSTANCE_SCHEMA) continue;
      found.push({ record, dir, alive: processAlive(record.pid) });
    } catch {
      // unreadable or partial record: not an instance
    }
  }
  return found.sort((a, b) => a.record.startedAt.localeCompare(b.record.startedAt));
}
