/**
 * `varve serve`: a long-lived headless session exposed over the control
 * protocol on a local socket, so several short-lived clients (an MCP bridge,
 * scripts) can share one document authority instead of each opening their own.
 *
 * Isolated by construction: the session owns its document, holds the file lock
 * for `--in-place`, and the socket directory and credential file are
 * owner-only. A client must present the credential in `session.hello`.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CONTROL_PROTOCOL } from '@varve/automation';
import { ControlClient, connectEndpoint } from '../control/client';
import {
  createInstanceDirectory,
  discoverInstances,
  INSTANCE_SCHEMA,
  type InstanceRecord,
} from '../control/instance';
import { startControlServer } from '../control/server';
import { parseRunArgs, UsageError } from './args';
import type { Io } from './commands';
import { EXIT, type ExitCode } from './exitCodes';
import { buildHeadlessRuntime, RUNTIME_FLAGS, RUNTIME_VALUES } from './runtime';
import { CLI_VERSION } from './version';

export async function runServe(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: [...RUNTIME_FLAGS, 'json'],
    values: [...RUNTIME_VALUES, 'runtime-dir', 'idle-exit-seconds'],
    aliases: { f: 'file', o: 'out' },
  });
  if (a.positionals.length > 0) throw new UsageError('serve takes options only');
  const idleSeconds = a.value('idle-exit-seconds');
  const idleMs = idleSeconds === undefined ? 0 : Number(idleSeconds) * 1000;
  if (!Number.isFinite(idleMs) || idleMs < 0) {
    throw new UsageError('--idle-exit-seconds must be a non-negative number');
  }
  const env = {
    ...io.env,
    ...(a.has('runtime-dir') ? { VARVE_RUNTIME_DIR: a.value('runtime-dir') } : {}),
  };

  const runtime = buildHeadlessRuntime(env, a, {
    id: 'serve-client',
    label: 'Control client',
    transport: 'ipc',
  });
  const { session } = runtime;
  const info = session.authority.info();
  const instance = createInstanceDirectory(env, info.instanceId);

  let idleTimer: NodeJS.Timeout | null = null;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const armIdle = (count: number): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (idleMs > 0 && count === 0) {
      idleTimer = setTimeout(() => finish(), idleMs);
    }
  };

  const server = await startControlServer({
    endpoint: instance.endpoint,
    token: instance.token,
    principal: (client) => ({ ...runtime.principal, label: client.name }),
    config: {
      executor: session.executor,
      authority: session.authority,
      externals: runtime.externals,
      serverInfo: { name: 'varve-cli', version: CLI_VERSION },
    },
    onConnectionCount: armIdle,
  });

  const record: InstanceRecord = {
    schema: INSTANCE_SCHEMA,
    instanceId: info.instanceId,
    mode: 'headless',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    app: { name: 'varve-cli', version: CLI_VERSION },
    protocol: CONTROL_PROTOCOL,
    endpoint: instance.endpoint,
    tokenFile: instance.tokenFile,
    document: { id: info.documentId, name: info.documentName },
  };
  writeFileSync(instance.recordPath, JSON.stringify(record), { mode: 0o600 });
  armIdle(0);

  const ready = {
    event: 'ready',
    ...record,
    grants: [...runtime.principal.grants],
    destination: runtime.destination?.path ?? null,
    note: 'headless session: not the running application',
  };
  io.out(`${JSON.stringify(ready)}\n`);

  const stop = (): void => finish();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await done;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (idleTimer) clearTimeout(idleTimer);
    await server.close();
    try {
      rmSync(instance.dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    runtime.release();
  }
  return EXIT.OK;
}

export async function runInstances(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, { flags: ['json', 'verify'], values: ['runtime-dir'] });
  const env = {
    ...io.env,
    ...(a.has('runtime-dir') ? { VARVE_RUNTIME_DIR: a.value('runtime-dir') } : {}),
  };
  const instances = discoverInstances(env);
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of instances) {
    const row: Record<string, unknown> = {
      instanceId: entry.record.instanceId,
      mode: entry.record.mode,
      app: entry.record.app,
      pid: entry.record.pid,
      alive: entry.alive,
      endpoint: entry.record.endpoint,
      document: entry.record.document,
    };
    if (a.flags.has('verify') && entry.alive) {
      // Prove the endpoint answers and identifies itself, using its own credential file.
      try {
        const token = readFileSync(entry.record.tokenFile, 'utf8').trim();
        const client = new ControlClient(await connectEndpoint(entry.record.endpoint, 2000), {
          requestTimeoutMs: 3000,
        });
        const hello = await client.hello(token, { name: 'varve instances' });
        row.verified = {
          mode: hello.session.mode,
          instanceId: hello.session.instanceId,
          documentId: hello.session.documentId,
        };
        client.close();
      } catch (error) {
        row.verified = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    rows.push(row);
  }
  if (a.flags.has('json')) {
    io.out(`${JSON.stringify({ instances: rows })}\n`);
  } else if (rows.length === 0) {
    io.out('no Varve control endpoints found\n');
  } else {
    for (const row of rows) {
      const doc = row.document as { name: string };
      io.out(
        `${row.instanceId}  ${row.mode}  pid ${row.pid}${row.alive ? '' : ' (not running)'}  "${doc.name}"  ${row.endpoint}\n`,
      );
    }
  }
  return EXIT.OK;
}
