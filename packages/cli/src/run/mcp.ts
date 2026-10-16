/**
 * `varve mcp`: a stdio MCP server.
 *
 * Two explicit modes, never a silent fallback between them:
 * - headless: `--file <doc>` or `--new <name>` opens an isolated in-process
 *   session. It is not the running application and says so in `varve_session`.
 * - attached: `--connect <endpoint> --token-file <path>` (or `--instance <id>`)
 *   attaches to an existing control endpoint. If the endpoint cannot be
 *   reached or does not authenticate, the server exits with an error; it does
 *   not open an empty document instead.
 *
 * stdout carries protocol messages only. Everything else goes to stderr.
 */
import { readFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ControlConnection } from '@varve/automation';
import {
  ControlClient,
  connectEndpoint,
  type HelloResult,
  loopbackTransport,
} from '../control/client';
import { discoverInstances } from '../control/instance';
import { createVarveMcpServer } from '../mcp/server';
import { parseRunArgs, UsageError } from './args';
import type { Io } from './commands';
import { EXIT, type ExitCode } from './exitCodes';
import { buildHeadlessRuntime, RUNTIME_FLAGS, RUNTIME_VALUES } from './runtime';
import { CLI_VERSION } from './version';

export async function runMcp(io: Io, argv: string[]): Promise<ExitCode> {
  const a = parseRunArgs(argv, {
    flags: [...RUNTIME_FLAGS],
    values: [
      ...RUNTIME_VALUES,
      'connect',
      'token-file',
      'instance',
      'runtime-dir',
      'legacy',
      'require-mode',
    ],
    aliases: { f: 'file', o: 'out' },
  });
  if (a.positionals.length > 0) throw new UsageError('mcp takes options only');
  const legacy = a.value('legacy') ?? 'serve';
  if (legacy !== 'serve' && legacy !== 'reject') {
    throw new UsageError('--legacy must be "serve" or "reject"');
  }
  const requireMode = a.value('require-mode');
  if (requireMode !== undefined && requireMode !== 'headless' && requireMode !== 'connected') {
    throw new UsageError('--require-mode must be "headless" or "connected"');
  }

  const attached = a.has('connect') || a.has('instance');
  const headless = a.has('file') || a.has('new');
  if (attached === headless) {
    throw new UsageError(
      'choose exactly one: --file/--new (isolated headless session) or --connect/--instance (attach to a running endpoint)',
    );
  }

  let client: ControlClient;
  let hello: HelloResult;
  let release: () => void = () => undefined;

  if (attached) {
    const env = {
      ...io.env,
      ...(a.has('runtime-dir') ? { VARVE_RUNTIME_DIR: a.value('runtime-dir') } : {}),
    };
    let endpoint = a.value('connect');
    let tokenFile = a.value('token-file');
    if (endpoint === undefined) {
      const wanted = a.value('instance') as string;
      const match = discoverInstances(env).find((i) => i.record.instanceId === wanted && i.alive);
      if (!match) {
        io.err(`varve mcp: no running endpoint with instance id ${wanted}\n`);
        return EXIT.IO;
      }
      endpoint = match.record.endpoint;
      tokenFile = tokenFile ?? match.record.tokenFile;
    }
    if (tokenFile === undefined) throw new UsageError('--connect needs --token-file <path>');
    let token: string;
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch (error) {
      io.err(`varve mcp: cannot read credential file ${tokenFile}: ${(error as Error).message}\n`);
      return EXIT.IO;
    }
    try {
      client = new ControlClient(await connectEndpoint(endpoint, 5000));
      hello = await client.hello(token, { name: 'varve-mcp', version: CLI_VERSION });
    } catch (error) {
      io.err(
        `varve mcp: could not attach to ${endpoint}: ${error instanceof Error ? error.message : String(error)}\n` +
          '          Not falling back to a headless session. Start the application or use --file.\n',
      );
      return EXIT.IO;
    }
  } else {
    const runtime = buildHeadlessRuntime(io.env, a, {
      id: 'mcp-client',
      label: 'MCP client',
      transport: 'stdio',
    });
    release = runtime.release;
    const connection = new ControlConnection({
      executor: runtime.session.executor,
      authority: runtime.session.authority,
      externals: runtime.externals,
      authenticate: () => runtime.principal,
      serverInfo: { name: 'varve-cli', version: CLI_VERSION },
    });
    client = new ControlClient(loopbackTransport(connection));
    hello = await client.hello('in-process', { name: 'varve-mcp', version: CLI_VERSION });
  }

  if (requireMode && hello.session.mode !== requireMode) {
    io.err(
      `varve mcp: required a ${requireMode} session but the endpoint is ${hello.session.mode}; refusing to continue\n`,
    );
    client.close();
    release();
    return EXIT.CONFLICT;
  }

  io.err(
    `varve mcp: ${hello.session.mode} session on "${hello.session.documentName}" ` +
      `(revision ${hello.session.revision}); permissions: ${hello.principal.grants.join(', ') || 'none'}\n`,
  );

  await new Promise<void>((resolve) => {
    const handle = serveStdio(
      () => {
        const server = createVarveMcpServer({ client, hello, serverVersion: CLI_VERSION });
        const previous = server.server.onclose;
        server.server.onclose = () => {
          previous?.();
          resolve();
        };
        return server;
      },
      {
        legacy,
        onerror: (error) => {
          process.stderr.write(`varve mcp: ${error.message}\n`);
        },
      },
    );
    const stop = (): void => {
      void handle.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  client.close();
  release();
  return EXIT.OK;
}
