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
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** The per-user runtime directory, created with owner-only permissions. */
export function runtimeDirectory(env: Record<string, string | undefined>): string {
  const explicit = env.VARVE_RUNTIME_DIR;
  const xdg = env.XDG_RUNTIME_DIR;
  const base =
    explicit && explicit.length > 0
      ? explicit
      : xdg?.startsWith('/')
        ? join(xdg, 'varve')
        : join(tmpdir(), `varve-${uid() ?? 'user'}`);
  ensurePrivateDirectory(base);
  return base;
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
  const dir = join(base, `v-${short}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
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
