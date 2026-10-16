/**
 * Builds the headless runtime shared by `serve` and `mcp`: the document
 * session, the file policy, the write destination and its lock, the principal
 * and the external-effect handlers. Always explicit about being headless; it
 * never looks for a running application.
 */
import {
  AUTHORIZATION_CLASSES,
  type AuthorizationClass,
  type ExternalHandler,
  type Principal,
} from '@varve/automation';
import { type ParsedArgs, UsageError } from './args';
import { acquireLock, type FileLock, PathPolicy } from './files';
import { createSaveHandler, type SaveDestination } from './save';
import { maxDocumentBytes, type OpenedSession, openFileSession, openNewSession } from './session';

export interface HeadlessRuntime {
  session: OpenedSession;
  principal: Principal;
  externals: Record<string, ExternalHandler>;
  policy: PathPolicy;
  destination: SaveDestination | null;
  release(): void;
}

export const RUNTIME_FLAGS = ['in-place', 'overwrite'] as const;
export const RUNTIME_VALUES = [
  'file',
  'new',
  'out',
  'grant',
  'read-root',
  'write-root',
  'client-label',
] as const;

export function parseGrants(raw: string | undefined): AuthorizationClass[] {
  if (raw === undefined) return ['read'];
  const requested = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (requested.length === 0) throw new UsageError('--grant needs at least one permission');
  const known = new Set<string>(AUTHORIZATION_CLASSES);
  const bad = requested.filter((part) => !known.has(part));
  if (bad.length > 0) {
    throw new UsageError(
      `unknown permission ${bad.join(', ')}; choose from ${AUTHORIZATION_CLASSES.join(', ')}`,
    );
  }
  return [...new Set(requested)] as AuthorizationClass[];
}

export function buildHeadlessRuntime(
  env: Record<string, string | undefined>,
  a: ParsedArgs,
  identity: { id: string; label: string; transport: Principal['transport'] },
): HeadlessRuntime {
  const file = a.value('file');
  const newName = a.value('new');
  const out = a.value('out');
  const inPlace = a.flags.has('in-place');
  if ((file === undefined) === (newName === undefined)) {
    throw new UsageError('give exactly one of --file <document> or --new <name>');
  }
  if (inPlace && out) throw new UsageError('--in-place and --out are mutually exclusive');
  if (inPlace && file === undefined) throw new UsageError('--in-place needs --file');

  const grants = parseGrants(a.value('grant'));
  const principal: Principal = {
    id: identity.id,
    kind: 'agent',
    label: a.value('client-label') ?? identity.label,
    transport: identity.transport,
    grants,
  };

  const policy = PathPolicy.fromEnv(env, {
    readRoots: a.values.get('read-root'),
    writeRoots: a.values.get('write-root'),
  });

  let lock: FileLock | null = null;
  let session: OpenedSession;
  let destination: SaveDestination | null = null;
  let loadedHash: string | null = null;

  if (file !== undefined) {
    const canonical = policy.resolveRead(file);
    if (inPlace) {
      policy.resolveWrite(canonical);
      lock = acquireLock(canonical);
    }
    try {
      session = openFileSession(policy, file, maxDocumentBytes(env), principal);
    } catch (error) {
      lock?.release();
      throw error;
    }
    loadedHash = session.source?.contentHash ?? null;
    if (inPlace) destination = { path: canonical, kind: 'in-place', overwrite: false };
  } else {
    session = openNewSession(newName as string, principal);
  }
  if (out) {
    destination = { path: out, kind: 'out', overwrite: a.flags.has('overwrite') };
    loadedHash = null;
  }

  const externals: Record<string, ExternalHandler> = {
    'varve.document.save': createSaveHandler({ policy, destination, loadedHash }),
  };
  session.ctx.externals = externals;

  return {
    session,
    principal,
    externals,
    policy,
    destination,
    release: () => lock?.release(),
  };
}
