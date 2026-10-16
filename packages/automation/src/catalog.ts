/**
 * Command catalog: the single registry every adapter publishes from.
 *
 * A command is data plus two pure functions: a `query` over a document, or a
 * `plan` that computes the next document. Neither touches React, a window, a
 * file or a transport, so the same definition runs in the headless CLI, the
 * MCP server and the live editor. Registration validates the definition so a
 * placeholder, a mislabeled effect, or an example that no longer matches its
 * schema fails at startup rather than at an agent's first call.
 */
import { type Document, type IdRng, sha256Utf8 } from '@varve/scene';
import type { DocumentAuthority, Origin, RollbackResult } from './authority';
import { type AuthorizationClass, FORBIDDEN_COMMAND_DOMAINS, type Principal } from './principal';
import { type Issue, type JsonSchema, type Schema, toJsonSchema, validateUnknown } from './schema';
import { canonicalJson, closestMatch } from './text';

export type Runtime = 'headless' | 'connected';

/**
 * - `read`     no state change
 * - `mutate`   changes the document; one undo group
 * - `view`     agent-scoped view state only; never the document
 * - `job`      long-running work with its own lifecycle
 * - `external` leaves the document or the device (export, upload)
 */
export type CommandEffect = 'read' | 'mutate' | 'view' | 'job' | 'external';

export interface CommandContext {
  principal: Principal;
  /**
   * Where new nodes go when the caller names no parent. `null` means the
   * document root. Always reported back in the receipt, never silent.
   */
  defaultParentId: string | null;
  now(): number;
  /** Deterministic id source for tests and replay; random when absent. */
  rng?: IdRng;
}

/** What a revert hook reports; the executor turns it into a receipt. */
export type RevertOutcome =
  | { ok: true; output: unknown; summary: string; result: Extract<RollbackResult, { ok: true }> }
  | {
      ok: false;
      code: 'CONFLICT' | 'HISTORY_EXPIRED' | 'UNKNOWN_TARGET';
      message: string;
      details?: Record<string, unknown>;
    };

export interface MutationPlan<O> {
  doc: Document;
  output: O;
  label: string;
  created?: string[];
  changed?: string[];
  deleted?: string[];
  warnings?: Issue[];
  /** Human sentence for the receipt; the executor writes a default otherwise. */
  summary?: string;
  /** Set when the plan intentionally changes nothing and says why. */
  noOp?: string;
}

export interface CommandExample<A> {
  title: string;
  args: A;
}

/**
 * Definition input. Deliberately not generic over the schemas: inferring
 * argument types from a schema through a recursive conditional type, inside
 * the same object literal as the callbacks, exhausts the compiler on real
 * commands. Callbacks annotate `args` with `Infer<typeof INPUT>` explicitly;
 * the executor validates arguments and results against the schemas at runtime,
 * so a mismatch cannot reach a document either way.
 */
export interface CommandSpec {
  id: string;
  version: number;
  title: string;
  summary: string;
  keywords?: string[];
  effect: CommandEffect;
  authorization: AuthorizationClass;
  runtimes: readonly Runtime[];
  input: Schema;
  output: Schema;
  examples?: CommandExample<unknown>[];
  /** Applying the same arguments twice leaves the same state as applying once. */
  naturallyIdempotent?: boolean;
  query?: (doc: Document, args: never, ctx: CommandContext) => unknown;
  plan?: (doc: Document, args: never, ctx: CommandContext) => MutationPlan<unknown>;
  /** Read that needs authority state (history), not just the document. */
  inspect?: (authority: DocumentAuthority, args: never, ctx: CommandContext) => unknown;
  /** Mutation expressed as an attributed rollback on the authority itself. */
  revert?: (
    authority: DocumentAuthority,
    args: never,
    env: { origin: Origin; receiptId: string; ctx: CommandContext },
  ) => RevertOutcome | Promise<RevertOutcome>;
}

/** Type-erased command as stored in the catalog. Arguments are validated first. */
export interface Command {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly summary: string;
  readonly domain: string;
  readonly keywords: readonly string[];
  readonly effect: CommandEffect;
  readonly authorization: AuthorizationClass;
  readonly runtimes: readonly Runtime[];
  readonly input: Schema;
  readonly output: Schema;
  readonly examples: readonly CommandExample<unknown>[];
  readonly naturallyIdempotent: boolean;
  query?(doc: Document, args: unknown, ctx: CommandContext): unknown;
  plan?(doc: Document, args: unknown, ctx: CommandContext): MutationPlan<unknown>;
  inspect?(authority: DocumentAuthority, args: unknown, ctx: CommandContext): unknown;
  revert?(
    authority: DocumentAuthority,
    args: unknown,
    env: { origin: Origin; receiptId: string; ctx: CommandContext },
  ): RevertOutcome | Promise<RevertOutcome>;
}

export function defineCommand(spec: CommandSpec): Command {
  const domain = spec.id.split('.')[1] ?? '';
  return {
    id: spec.id,
    version: spec.version,
    title: spec.title,
    summary: spec.summary,
    domain,
    keywords: spec.keywords ?? [],
    effect: spec.effect,
    authorization: spec.authorization,
    runtimes: spec.runtimes,
    input: spec.input,
    output: spec.output,
    examples: (spec.examples ?? []) as CommandExample<unknown>[],
    naturallyIdempotent: spec.naturallyIdempotent ?? false,
    query: spec.query as Command['query'],
    plan: spec.plan as Command['plan'],
    inspect: spec.inspect as Command['inspect'],
    revert: spec.revert as Command['revert'],
  };
}

export interface CommandDescription {
  id: string;
  version: number;
  title: string;
  summary: string;
  domain: string;
  effect: CommandEffect;
  authorization: AuthorizationClass;
  runtimes: readonly Runtime[];
  naturallyIdempotent: boolean;
  /** Changes whenever the input or output contract changes. */
  schemaHash: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  examples: readonly CommandExample<unknown>[];
}

export interface CommandSummary {
  id: string;
  version: number;
  title: string;
  summary: string;
  effect: CommandEffect;
  authorization: AuthorizationClass;
  runtimes: readonly Runtime[];
}

const ID_PATTERN = /^varve\.[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

const EFFECT_AUTHORIZATION: Readonly<Record<CommandEffect, readonly AuthorizationClass[]>> = {
  read: ['read'],
  mutate: ['edit'],
  view: ['view'],
  job: ['edit', 'export', 'capture', 'external'],
  external: ['export', 'capture', 'external'],
};

export class CommandCatalog {
  private readonly commands = new Map<string, Command>();
  private readonly described = new Map<string, CommandDescription>();

  register(command: Command): void {
    const problems = this.problemsWith(command);
    if (problems.length > 0) {
      throw new Error(`invalid command ${command.id}: ${problems.join('; ')}`);
    }
    this.commands.set(command.id, command);
  }

  private problemsWith(command: Command): string[] {
    const problems: string[] = [];
    if (!ID_PATTERN.test(command.id)) problems.push('id must match varve.<domain>.<verb>');
    if (this.commands.has(command.id)) problems.push('duplicate command id');
    if (!Number.isInteger(command.version) || command.version < 1) {
      problems.push('version must be a positive integer');
    }
    if (FORBIDDEN_COMMAND_DOMAINS.includes(command.domain)) {
      problems.push(`domain "${command.domain}" is never exposed to automation`);
    }
    if (command.runtimes.length === 0) problems.push('declares no runtime');
    if (!EFFECT_AUTHORIZATION[command.effect].includes(command.authorization)) {
      problems.push(
        `effect "${command.effect}" cannot be authorized as "${command.authorization}"`,
      );
    }
    const readImpl = [command.query, command.inspect].filter((fn) => typeof fn === 'function');
    const mutateImpl = [command.plan, command.revert].filter((fn) => typeof fn === 'function');
    if (command.effect === 'read' && (readImpl.length !== 1 || mutateImpl.length > 0)) {
      problems.push('a read command must define exactly one of query/inspect and no mutation hook');
    }
    if (command.effect === 'mutate' && (mutateImpl.length !== 1 || readImpl.length > 0)) {
      problems.push('a mutate command must define exactly one of plan/revert and no read hook');
    }
    if (
      command.effect !== 'read' &&
      command.effect !== 'mutate' &&
      readImpl.length + mutateImpl.length > 0
    ) {
      problems.push(`a ${command.effect} command is served by its runtime adapter, not here`);
    }
    for (const example of command.examples) {
      const result = validateUnknown(command.input, example.args);
      if (!result.ok) {
        problems.push(
          `example "${example.title}" no longer matches the input schema (${result.issues[0]?.path || '/'}: ${result.issues[0]?.message})`,
        );
      }
    }
    return problems;
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** Nearest registered id, for "did you mean" on a mistyped command. */
  suggest(id: string): string | undefined {
    return closestMatch(id, [...this.commands.keys()], 4);
  }

  private visibleTo(command: Command, principal?: Principal): boolean {
    return principal === undefined || principal.grants.includes(command.authorization);
  }

  list(
    filter: {
      principal?: Principal;
      runtime?: Runtime;
      effect?: CommandEffect;
      domain?: string;
    } = {},
  ): CommandSummary[] {
    const out: CommandSummary[] = [];
    for (const command of this.commands.values()) {
      if (!this.visibleTo(command, filter.principal)) continue;
      if (filter.runtime && !command.runtimes.includes(filter.runtime)) continue;
      if (filter.effect && command.effect !== filter.effect) continue;
      if (filter.domain && command.domain !== filter.domain) continue;
      out.push(summaryOf(command));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Offline lookup: exact id, then id/title/keyword token matches. No
   * embeddings and no network, so it works on an air-gapped machine.
   */
  search(
    query: string,
    filter: { principal?: Principal; runtime?: Runtime; limit?: number } = {},
  ): CommandSummary[] {
    const needle = query.trim().toLowerCase();
    const tokens = needle.split(/[\s._-]+/).filter(Boolean);
    const scored: Array<{ score: number; summary: CommandSummary }> = [];
    for (const command of this.commands.values()) {
      if (!this.visibleTo(command, filter.principal)) continue;
      if (filter.runtime && !command.runtimes.includes(filter.runtime)) continue;
      let score = 0;
      if (needle === command.id.toLowerCase()) score = 100;
      else if (needle && command.id.toLowerCase().startsWith(needle)) score = 60;
      else if (needle && command.id.toLowerCase().includes(needle)) score = 40;
      if (tokens.length > 0) {
        const haystack = [
          command.id,
          command.title,
          command.summary,
          command.domain,
          ...command.keywords,
        ]
          .join(' ')
          .toLowerCase();
        const hits = tokens.filter((token) => haystack.includes(token)).length;
        if (hits === tokens.length) score = Math.max(score, 20 + hits * 5);
        else if (hits > 0) score = Math.max(score, hits * 4);
      } else {
        score = 1;
      }
      if (score > 0) scored.push({ score, summary: summaryOf(command) });
    }
    scored.sort((a, b) => b.score - a.score || a.summary.id.localeCompare(b.summary.id));
    return scored.slice(0, filter.limit ?? 25).map((entry) => entry.summary);
  }

  describe(id: string): CommandDescription | undefined {
    const cached = this.described.get(id);
    if (cached) return cached;
    const command = this.commands.get(id);
    if (!command) return undefined;
    const inputSchema = toJsonSchema(command.input);
    const outputSchema = toJsonSchema(command.output);
    const schemaHash = sha256Utf8(
      canonicalJson({
        id: command.id,
        version: command.version,
        effect: command.effect,
        authorization: command.authorization,
        inputSchema,
        outputSchema,
      }),
    ).slice(0, 16);
    const description: CommandDescription = {
      id: command.id,
      version: command.version,
      title: command.title,
      summary: command.summary,
      domain: command.domain,
      effect: command.effect,
      authorization: command.authorization,
      runtimes: command.runtimes,
      naturallyIdempotent: command.naturallyIdempotent,
      schemaHash,
      inputSchema,
      outputSchema,
      examples: command.examples,
    };
    this.described.set(id, description);
    return description;
  }

  /** Digest of every command id, version and schema: a client drift check. */
  catalogHash(): string {
    const lines = [...this.commands.keys()]
      .sort()
      .map((id) => `${id}@${this.describe(id)?.version}:${this.describe(id)?.schemaHash}`);
    return sha256Utf8(lines.join('\n')).slice(0, 16);
  }

  get size(): number {
    return this.commands.size;
  }
}

function summaryOf(command: Command): CommandSummary {
  return {
    id: command.id,
    version: command.version,
    title: command.title,
    summary: command.summary,
    effect: command.effect,
    authorization: command.authorization,
    runtimes: command.runtimes,
  };
}
