/**
 * The executor: one validated path from "a caller asked for X" to "revision N
 * was committed" (or a precise, structured refusal).
 *
 * Every adapter (CLI, JSON control channel, MCP, the live editor bridge)
 * calls `execute` / `executeBatch`. Nothing downstream of this module trusts
 * that the caller validated anything, because the inputs include ones the GUI
 * cannot generate (LightCraft #1947). Order of checks is deliberate:
 *
 *   envelope → command lookup → runtime → authorization → target pin →
 *   argument schema → idempotency → revision precondition → plan →
 *   output schema → commit → receipt
 *
 * Authorization is checked here and only here, so an alias, a batch step or a
 * retry cannot reach a command the principal was not granted.
 *
 * What this module does NOT do is verify document invariants: parent existence,
 * acyclic containment, mask and scope references, and everything else a `plan`
 * must not violate are the responsibility of each command, which raises
 * `INVARIANT_VIOLATION` itself. A new command that omits them will not be caught
 * centrally. The receipt's created/changed/deleted sets are the exception and do
 * hold centrally, because they are derived by diffing the documents rather than
 * taken from the command — so a command cannot make a receipt lie.
 */
import type { Document, IdRng } from '@varve/scene';
import { sha256Utf8 } from '@varve/scene';
import type { CommitPlan, DocumentAuthority, Origin } from './authority';
import type { Command, CommandCatalog, CommandContext, CommandEffect } from './catalog';
import { touchedBetween } from './diff';
import { CommandRejection, type ErrorCode, type ErrorInfo, errorInfo } from './errors';
import { IdempotencyStore } from './idempotency';
import { idempotencyScope, type Principal } from './principal';
import type {
  BatchReceipt,
  BatchStepReceipt,
  DurableInfo,
  Outcome,
  Receipt,
  TargetInfo,
} from './receipt';
import { RECEIPT_SCHEMA } from './receipt';
import { type Issue, s, validate, validateUnknown } from './schema';
import { defaultInsertionParent } from './surface';
import { canonicalJson, closestMatch, utf8ByteLength } from './text';

export interface Limits {
  /** Canonical UTF-8 size of one request. */
  maxRequestBytes: number;
  maxBatchSteps: number;
  /** Cap on ids a single receipt will list, so a mass edit cannot blow a response. */
  maxReceiptIds: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxRequestBytes: 1024 * 1024,
  maxBatchSteps: 100,
  maxReceiptIds: 5000,
};

const KEY_PATTERN = '^[A-Za-z0-9._:-]{1,128}$';
const ALIAS_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}$';

const TARGET_PIN = s.object(
  {
    documentId: s.optional(s.string({ maxBytes: 128 })),
    generation: s.optional(s.string({ maxBytes: 128 })),
    instanceId: s.optional(s.string({ maxBytes: 128 })),
  },
  { description: 'Pins the document/session the caller believes it is addressing.' },
);

export const EXECUTE_REQUEST_SCHEMA = s.object({
  command: s.string({ maxBytes: 128 }),
  args: s.optional(s.any()),
  idempotencyKey: s.optional(s.string({ maxBytes: 128, pattern: KEY_PATTERN })),
  attempt: s.optional(s.integer({ min: 1, max: 1000 })),
  expectedRevision: s.optional(s.integer({ min: 0 })),
  commandVersion: s.optional(s.integer({ min: 1 })),
  dryRun: s.optional(s.boolean()),
  alias: s.optional(s.string({ maxBytes: 64, pattern: ALIAS_PATTERN })),
  target: s.optional(TARGET_PIN),
});

const BATCH_STEP = s.object({
  command: s.string({ maxBytes: 128 }),
  args: s.optional(s.any()),
  alias: s.optional(s.string({ maxBytes: 64, pattern: ALIAS_PATTERN })),
});

export const BATCH_REQUEST_SCHEMA = s.object({
  mode: s.enum(['atomic', 'partial'] as const, { default: 'atomic' }),
  steps: s.array(BATCH_STEP, { minItems: 1, maxItems: DEFAULT_LIMITS.maxBatchSteps }),
  onError: s.optional(s.enum(['stop', 'continue'] as const)),
  idempotencyKey: s.optional(s.string({ maxBytes: 128, pattern: KEY_PATTERN })),
  attempt: s.optional(s.integer({ min: 1, max: 1000 })),
  expectedRevision: s.optional(s.integer({ min: 0 })),
  dryRun: s.optional(s.boolean()),
  target: s.optional(TARGET_PIN),
});

export interface ExternalEnv {
  principal: Principal;
  authority: DocumentAuthority;
  receiptId: string;
}

export type ExternalResult =
  | { ok: true; summary: string; output: unknown; durable?: DurableInfo }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      hint?: string;
      details?: Record<string, unknown>;
    };

/**
 * Runtime-supplied implementation of a command with effects beyond the
 * document (saving a file, exporting). Supplied by the adapter that owns the
 * file system or transport; the core never touches either.
 */
export type ExternalHandler = (
  args: unknown,
  env: ExternalEnv,
) => Promise<ExternalResult> | ExternalResult;

/**
 * What a person is asked to approve. It names the exact operation: command,
 * validated arguments, target and the revision the plan was computed against.
 * An approval is single-use and is rechecked against the revision before the
 * commit, so a stale approval can never apply to a document that has moved.
 */
export interface ApprovalRequest {
  receiptId: string;
  principal: { id: string; label: string; kind: string };
  command: string;
  commandTitle: string;
  effect: string;
  authorization: string;
  args: unknown;
  target: TargetInfo;
  revision: number;
  preview: { label: string; created: string[]; changed: string[]; deleted: string[] } | null;
}

export type ApprovalDecision = { approved: true } | { approved: false; reason?: string };

export interface ObservedReceipt {
  principal: { id: string; label: string; kind: string };
  receipt: Receipt | BatchReceipt;
  kind: 'single' | 'batch';
}

/**
 * Host policy for the effects this session currently refuses.
 *
 * "Stop automation" must block new commits without closing the editor and
 * without making the client blind: reads and agent-scoped view changes keep
 * working, so a paused client can still see *why* it is paused. The policy is
 * supplied by the trusted host, is never reachable from a request, and cannot
 * grant anything — it can only refuse.
 */
export interface ExecutionPolicy {
  /** A readable reason to refuse this effect, or `null` to allow it. */
  blockReason(effect: CommandEffect): string | null;
}

export interface ExecutorContext {
  principal: Principal;
  authority: DocumentAuthority;
  /**
   * When present, every operation that changes anything is held until the
   * callback resolves. The callback is supplied by the trusted host (a UI), is
   * never reachable from a request, and has no "approve" method an agent can
   * call.
   */
  approval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Host policy: refuse effects the session is currently not permitted to run. */
  policy?: ExecutionPolicy;
  /** Handlers for `external` commands, keyed by command id. */
  externals?: Readonly<Record<string, ExternalHandler>>;
  /** Default parent for node creation; connected mode supplies the active surface. */
  defaultParentId?: () => string | null;
  now?: () => number;
  rng?: IdRng;
}

export interface ExecutorOptions {
  catalog: CommandCatalog;
  /** Called after every receipt, for activity logs. Must not throw into the caller. */
  onReceipt?: (observed: ObservedReceipt) => void;
  idempotency?: IdempotencyStore;
  limits?: Partial<Limits>;
  newId?: () => string;
}

interface Evaluated {
  doc: Document;
  output: unknown;
  label: string;
  warnings: Issue[];
  summary?: string;
  noOp?: string;
  mutating: boolean;
  created: string[];
  changed: string[];
  deleted: string[];
}

interface StepResult {
  output: unknown;
  created: string[];
  changed: string[];
  deleted: string[];
  idMap: Record<string, string>;
}

export class Executor {
  readonly catalog: CommandCatalog;
  private readonly idempotency: IdempotencyStore;
  private readonly limits: Limits;
  private readonly newId: () => string;
  private readonly onReceipt?: ExecutorOptions['onReceipt'];
  private receiptCounter = 0;

  constructor(options: ExecutorOptions) {
    this.catalog = options.catalog;
    this.idempotency = options.idempotency ?? new IdempotencyStore();
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.onReceipt = options.onReceipt;
    this.newId =
      options.newId ??
      (() => {
        this.receiptCounter += 1;
        return `r${Date.now().toString(36)}${this.receiptCounter.toString(36)}`;
      });
  }

  // ── Single command ────────────────────────────────────────────────────────

  async execute(ctx: ExecutorContext, request: unknown): Promise<Receipt> {
    const receiptId = this.newId();
    let receipt: Receipt;
    try {
      receipt = await this.executeSingle(ctx, request, receiptId);
    } catch (error) {
      receipt = this.rejected(ctx, receiptId, 'unknown', 0, internalError(error));
    }
    this.observe(ctx, receipt, 'single');
    return receipt;
  }

  private observe(ctx: ExecutorContext, receipt: Receipt | BatchReceipt, kind: 'single' | 'batch') {
    if (!this.onReceipt) return;
    try {
      this.onReceipt({
        principal: {
          id: ctx.principal.id,
          label: ctx.principal.label,
          kind: ctx.principal.kind,
        },
        receipt,
        kind,
      });
    } catch {
      // An observer failure must never change the result of an operation.
    }
  }

  /** Hold an operation for a person's decision, then recheck what it was based on. */
  private async requireApproval(
    ctx: ExecutorContext,
    command: Command,
    receiptId: string,
    args: unknown,
    revision: number,
    preview: ApprovalRequest['preview'],
  ): Promise<ErrorInfo | null> {
    if (!ctx.approval) return null;
    let decision: ApprovalDecision;
    try {
      decision = await ctx.approval({
        receiptId,
        principal: {
          id: ctx.principal.id,
          label: ctx.principal.label,
          kind: ctx.principal.kind,
        },
        command: command.id,
        commandTitle: command.title,
        effect: command.effect,
        authorization: command.authorization,
        args,
        target: this.target(ctx),
        revision,
        preview,
      });
    } catch {
      return errorInfo('PERMISSION_DENIED', {
        message: 'the approval could not be obtained, so nothing was changed',
      });
    }
    if (!decision.approved) {
      return errorInfo('PERMISSION_DENIED', {
        message: `the person using Varve did not approve this change${decision.reason ? `: ${decision.reason}` : ''}`,
        hint: 'ask what they would like instead; do not retry the same request unchanged',
      });
    }
    const availability = ctx.authority.availability?.();
    if (availability && !availability.ok) {
      return errorInfo(availability.code, { message: availability.message });
    }
    const now = ctx.authority.getRevision();
    if (now !== revision) {
      return errorInfo('REVISION_CONFLICT', {
        message: `the document changed from revision ${revision} to ${now} while waiting for approval; the approval no longer applies`,
        hint: 'read the document again and propose the change against the current state',
        details: { expected: revision, current: now },
      });
    }
    return null;
  }

  private async executeSingle(
    ctx: ExecutorContext,
    raw: unknown,
    receiptId: string,
  ): Promise<Receipt> {
    const sizeError = this.checkSize(raw);
    if (sizeError) return this.rejected(ctx, receiptId, 'unknown', 0, sizeError);

    const envelope = validate(EXECUTE_REQUEST_SCHEMA, raw);
    if (!envelope.ok) {
      return this.rejected(
        ctx,
        receiptId,
        commandNameOf(raw),
        0,
        errorInfo('INVALID_ARGUMENT', {
          message: `the request envelope is invalid: ${envelope.issues[0]?.message ?? 'see issues'}`,
          issues: envelope.issues,
          hint: 'valid envelope keys: command, args, idempotencyKey, attempt, expectedRevision, commandVersion, dryRun, alias, target',
        }),
      );
    }
    const request = envelope.value;

    const command = this.catalog.get(request.command);
    if (!command)
      return this.rejected(
        ctx,
        receiptId,
        request.command,
        0,
        this.unknownCommand(ctx, request.command),
      );
    const version = command.version;

    const gate = this.gate(ctx, command, request.target, request.commandVersion);
    if (gate) return this.rejected(ctx, receiptId, command.id, version, gate);

    const parsed = validateUnknown(command.input, request.args ?? {});
    if (!parsed.ok) {
      return this.rejected(
        ctx,
        receiptId,
        command.id,
        version,
        errorInfo('INVALID_ARGUMENT', {
          message: `arguments for ${command.id} are invalid: ${parsed.issues[0]?.path || '/'}: ${parsed.issues[0]?.message}`,
          issues: parsed.issues,
          hint: `run "describe ${command.id}" for the schema and an example`,
        }),
      );
    }

    const info = ctx.authority.info();
    const argsHash = hashArgs(command.id, parsed.value);
    const replay = this.checkIdempotency(
      ctx,
      info.documentId,
      request.idempotencyKey,
      request.attempt,
      command.id,
      argsHash,
    );
    if (replay.kind === 'replay') {
      return {
        ...(replay.receipt as Receipt),
        idempotency: { key: request.idempotencyKey as string, replayed: true, argsHash },
      };
    }
    if (replay.kind === 'error') {
      return this.rejected(ctx, receiptId, command.id, version, replay.error, replay.outcome);
    }

    const revisionBefore = ctx.authority.getRevision();
    if (request.expectedRevision !== undefined && request.expectedRevision !== revisionBefore) {
      return this.rejected(
        ctx,
        receiptId,
        command.id,
        version,
        staleRevision(request.expectedRevision, revisionBefore),
      );
    }

    const cctx = this.commandContext(ctx);

    if (command.effect === 'external' || command.effect === 'job') {
      const handler = ctx.externals?.[command.id];
      if (!handler) {
        return this.rejected(
          ctx,
          receiptId,
          command.id,
          version,
          errorInfo('UNAVAILABLE', {
            message: `${command.id} is not available in this session: no runtime handler is attached for it`,
            hint: 'this session does not provide that capability; nothing was changed',
          }),
        );
      }
      if (request.dryRun) {
        return {
          ...this.baseReceipt(ctx, receiptId, command, parsed.defaulted),
          outcome: 'preview',
          summary: `Would run ${command.title}. Nothing was changed.`,
        };
      }
      const refusedExternal = await this.requireApproval(
        ctx,
        command,
        receiptId,
        parsed.value,
        revisionBefore,
        null,
      );
      if (refusedExternal) {
        return this.rejected(ctx, receiptId, command.id, version, refusedExternal);
      }
      const result = await handler(parsed.value, {
        principal: ctx.principal,
        authority: ctx.authority,
        receiptId,
      });
      if (!result.ok) {
        return this.rejected(
          ctx,
          receiptId,
          command.id,
          version,
          errorInfo(result.code, {
            message: result.message,
            ...(result.hint ? { hint: result.hint } : {}),
            ...(result.details ? { details: result.details } : {}),
          }),
        );
      }
      this.assertOutput(command, result.output);
      let completed: Receipt = {
        ...this.baseReceipt(ctx, receiptId, command, parsed.defaulted),
        outcome: 'applied',
        summary: result.summary,
        output: result.output,
        durable: result.durable ?? { saved: false },
      };
      if (request.idempotencyKey) {
        this.idempotency.record({
          key: request.idempotencyKey,
          principalId: idempotencyScope(ctx.principal),
          documentId: info.documentId,
          operation: command.id,
          argsHash,
          receipt: completed,
          storedAt: (ctx.now ?? Date.now)(),
        });
        completed = {
          ...completed,
          idempotency: { key: request.idempotencyKey, replayed: false, argsHash },
        };
      }
      return completed;
    }

    if (command.revert) {
      if (request.dryRun) {
        return {
          ...this.baseReceipt(ctx, receiptId, command, parsed.defaulted),
          outcome: 'preview',
          summary: `Would run ${command.title}. Nothing was changed.`,
        };
      }
      const refusedRevert = await this.requireApproval(
        ctx,
        command,
        receiptId,
        parsed.value,
        revisionBefore,
        null,
      );
      if (refusedRevert) return this.rejected(ctx, receiptId, command.id, version, refusedRevert);
      const outcome = await command.revert(ctx.authority, parsed.value, {
        origin: originOf(ctx.principal),
        receiptId,
        ctx: cctx,
      });
      if (!outcome.ok) {
        return this.rejected(
          ctx,
          receiptId,
          command.id,
          version,
          errorInfo(outcome.code, { message: outcome.message, details: outcome.details }),
        );
      }
      const reverted: Receipt = {
        ...this.baseReceipt(ctx, receiptId, command, parsed.defaulted),
        outcome: 'applied',
        summary: outcome.summary,
        revision: { before: revisionBefore, after: outcome.result.revision },
        changed: outcome.result.restored.filter((id) => !id.startsWith('field:')),
        output: outcome.output,
        transactionId: outcome.result.transactionId,
      };
      if (request.idempotencyKey) {
        this.idempotency.record({
          key: request.idempotencyKey,
          principalId: idempotencyScope(ctx.principal),
          documentId: info.documentId,
          operation: command.id,
          argsHash,
          receipt: reverted,
          storedAt: (ctx.now ?? Date.now)(),
        });
        return {
          ...reverted,
          idempotency: { key: request.idempotencyKey, replayed: false, argsHash },
        };
      }
      return reverted;
    }

    const original = ctx.authority.getDocument();
    let evaluated: Evaluated;
    try {
      evaluated = this.evaluate(command, parsed.value, original, cctx, ctx.authority);
    } catch (error) {
      if (error instanceof CommandRejection) {
        return this.rejected(ctx, receiptId, command.id, version, error.info);
      }
      throw error;
    }

    const base = this.baseReceipt(ctx, receiptId, command, parsed.defaulted);
    let receipt: Receipt;

    if (!evaluated.mutating) {
      receipt = {
        ...base,
        outcome: 'ok',
        summary: `${command.title}: ok`,
        output: evaluated.output,
        warnings: evaluated.warnings,
      };
    } else if (evaluated.doc === original || evaluated.noOp !== undefined) {
      receipt = {
        ...base,
        outcome: 'no-op',
        summary: `${command.title}: nothing changed${evaluated.noOp ? ` (${evaluated.noOp})` : ''}`,
        output: evaluated.output,
        warnings: evaluated.warnings,
      };
    } else if (request.dryRun) {
      const sets = this.exactSets(original, evaluated);
      receipt = {
        ...base,
        outcome: 'preview',
        summary: `Would apply "${evaluated.label}": ${describeSets(sets)}. Nothing was changed.`,
        created: sets.created,
        changed: sets.changed,
        deleted: sets.deleted,
        output: evaluated.output,
        warnings: evaluated.warnings,
        idMap: aliasMap(request.alias, sets.created),
      };
    } else {
      const sets = this.exactSets(original, evaluated);
      const refused = await this.requireApproval(
        ctx,
        command,
        receiptId,
        parsed.value,
        revisionBefore,
        {
          label: evaluated.label,
          created: sets.created,
          changed: sets.changed,
          deleted: sets.deleted,
        },
      );
      if (refused) return this.rejected(ctx, receiptId, command.id, version, refused);
      const plan: CommitPlan = {
        doc: evaluated.doc,
        label: evaluated.label,
        created: sets.created,
        changed: sets.changed,
        deleted: sets.deleted,
        warnings: evaluated.warnings,
      };
      const committed = await ctx.authority.commit({
        plan,
        origin: originOf(ctx.principal),
        command: command.id,
        receiptId,
        baseRevision: revisionBefore,
      });
      if (!committed.ok) {
        return this.rejected(
          ctx,
          receiptId,
          command.id,
          version,
          committed.reason === 'unavailable'
            ? errorInfo(committed.code ?? 'TARGET_MISMATCH', { message: committed.message })
            : staleRevision(revisionBefore, committed.currentRevision),
        );
      }
      receipt = {
        ...base,
        outcome: 'applied',
        summary:
          evaluated.summary ??
          `${evaluated.label}: ${describeSets(sets)} (revision ${revisionBefore} -> ${committed.revision}).`,
        revision: { before: revisionBefore, after: committed.revision },
        created: sets.created,
        changed: sets.changed,
        deleted: sets.deleted,
        idMap: aliasMap(request.alias, sets.created),
        output: evaluated.output,
        warnings: evaluated.warnings,
        transactionId: committed.transactionId,
      };
    }

    if (request.idempotencyKey && !request.dryRun) {
      this.idempotency.record({
        key: request.idempotencyKey,
        principalId: idempotencyScope(ctx.principal),
        documentId: info.documentId,
        operation: command.id,
        argsHash,
        receipt,
        storedAt: (ctx.now ?? Date.now)(),
      });
      receipt = {
        ...receipt,
        idempotency: { key: request.idempotencyKey, replayed: false, argsHash },
      };
    }
    return receipt;
  }

  // ── Batch ─────────────────────────────────────────────────────────────────

  async executeBatch(ctx: ExecutorContext, request: unknown): Promise<BatchReceipt> {
    const receiptId = this.newId();
    let receipt: BatchReceipt;
    try {
      receipt = await this.runBatch(ctx, request, receiptId);
    } catch (error) {
      receipt = this.batchRejected(ctx, receiptId, 'atomic', [], internalError(error));
    }
    this.observe(ctx, receipt, 'batch');
    return receipt;
  }

  private async runBatch(
    ctx: ExecutorContext,
    raw: unknown,
    receiptId: string,
  ): Promise<BatchReceipt> {
    const sizeError = this.checkSize(raw);
    if (sizeError) return this.batchRejected(ctx, receiptId, 'atomic', [], sizeError);

    const envelope = validate(BATCH_REQUEST_SCHEMA, raw);
    if (!envelope.ok) {
      return this.batchRejected(
        ctx,
        receiptId,
        'atomic',
        [],
        errorInfo('INVALID_ARGUMENT', {
          message: `the batch envelope is invalid: ${envelope.issues[0]?.path || '/'}: ${envelope.issues[0]?.message}`,
          issues: envelope.issues,
        }),
      );
    }
    const batch = envelope.value;
    if (batch.steps.length > this.limits.maxBatchSteps) {
      return this.batchRejected(
        ctx,
        receiptId,
        batch.mode,
        [],
        errorInfo('LIMIT_EXCEEDED', {
          message: `a batch may contain at most ${this.limits.maxBatchSteps} steps`,
        }),
      );
    }

    const aliases = new Set<string>();
    for (const [index, step] of batch.steps.entries()) {
      if (step.alias !== undefined) {
        if (aliases.has(step.alias)) {
          return this.batchRejected(
            ctx,
            receiptId,
            batch.mode,
            [],
            errorInfo('INVALID_ARGUMENT', {
              message: `step ${index}: alias "${step.alias}" is used more than once`,
            }),
          );
        }
        aliases.add(step.alias);
      }
    }

    // Static pre-pass: nothing is evaluated, but every failure that does not
    // depend on a previous step's output is found before any work happens.
    for (const [index, step] of batch.steps.entries()) {
      const command = this.catalog.get(step.command);
      if (!command) {
        return this.batchRejected(
          ctx,
          receiptId,
          batch.mode,
          [],
          withStep(this.unknownCommand(ctx, step.command), index),
        );
      }
      const gate = this.gate(ctx, command, batch.target, undefined);
      if (gate) return this.batchRejected(ctx, receiptId, batch.mode, [], withStep(gate, index));
      if (batch.mode === 'atomic' && command.effect !== 'read' && command.effect !== 'mutate') {
        return this.batchRejected(
          ctx,
          receiptId,
          batch.mode,
          [],
          errorInfo('INVALID_ARGUMENT', {
            message: `step ${index}: ${command.id} has external effects and cannot be part of an atomic batch that promises rollback`,
            hint: 'run it as its own request, or use mode "partial" and accept that it cannot be rolled back with the rest',
            details: { step: index },
          }),
        );
      }
    }

    const info = ctx.authority.info();
    const argsHash = hashArgs('batch', {
      mode: batch.mode,
      steps: batch.steps,
      onError: batch.onError,
    });
    const replay = this.checkIdempotency(
      ctx,
      info.documentId,
      batch.idempotencyKey,
      batch.attempt,
      'batch',
      argsHash,
    );
    if (replay.kind === 'replay') return replay.receipt as BatchReceipt;
    if (replay.kind === 'error') {
      return this.batchRejected(ctx, receiptId, batch.mode, [], replay.error, replay.outcome);
    }

    const revisionBefore = ctx.authority.getRevision();
    if (batch.expectedRevision !== undefined && batch.expectedRevision !== revisionBefore) {
      return this.batchRejected(
        ctx,
        receiptId,
        batch.mode,
        [],
        staleRevision(batch.expectedRevision, revisionBefore),
      );
    }

    const receipt =
      batch.mode === 'atomic'
        ? await this.runAtomic(ctx, receiptId, batch.steps, batch.dryRun === true, revisionBefore)
        : await this.runPartial(
            ctx,
            receiptId,
            batch.steps,
            batch.onError ?? 'stop',
            batch.dryRun === true,
            revisionBefore,
          );

    if (batch.idempotencyKey && !batch.dryRun) {
      this.idempotency.record({
        key: batch.idempotencyKey,
        principalId: idempotencyScope(ctx.principal),
        documentId: info.documentId,
        operation: 'batch',
        argsHash,
        receipt,
        storedAt: (ctx.now ?? Date.now)(),
      });
    }
    return receipt;
  }

  private async runAtomic(
    ctx: ExecutorContext,
    receiptId: string,
    steps: Array<{ command: string; args?: unknown; alias?: string }>,
    dryRun: boolean,
    revisionBefore: number,
  ): Promise<BatchReceipt> {
    const original = ctx.authority.getDocument();
    const cctx = this.commandContext(ctx);
    const results = new Map<string, StepResult>();
    const stepReceipts: BatchStepReceipt[] = [];
    let working = original;

    for (const [index, step] of steps.entries()) {
      const command = this.catalog.get(step.command) as Command;
      try {
        const resolved = resolveRefs(step.args ?? {}, results, index);
        const parsed = validateUnknown(command.input, resolved);
        if (!parsed.ok) {
          throw new CommandRejection('INVALID_ARGUMENT', {
            message: `step ${index} (${command.id}): ${parsed.issues[0]?.path || '/'}: ${parsed.issues[0]?.message}`,
            issues: parsed.issues,
            details: { step: index },
          });
        }
        const evaluated = this.evaluate(command, parsed.value, working, cctx, ctx.authority);
        const sets = this.exactSets(working, evaluated);
        working = evaluated.doc;
        const idMap = aliasMap(step.alias, sets.created);
        if (step.alias) {
          results.set(step.alias, {
            output: evaluated.output,
            created: sets.created,
            changed: sets.changed,
            deleted: sets.deleted,
            idMap,
          });
        }
        stepReceipts.push({
          step: index,
          ...(step.alias ? { alias: step.alias } : {}),
          receipt: {
            ...this.baseReceipt(ctx, `${receiptId}.${index}`, command, parsed.defaulted),
            outcome: evaluated.mutating ? 'preview' : 'ok',
            summary: evaluated.mutating
              ? `Staged "${evaluated.label}": ${describeSets(sets)}.`
              : `${command.title}: ok`,
            created: sets.created,
            changed: sets.changed,
            deleted: sets.deleted,
            idMap,
            output: evaluated.output,
            warnings: evaluated.warnings,
          },
        });
      } catch (error) {
        const info = error instanceof CommandRejection ? error.info : internalError(error);
        const failed: BatchStepReceipt = {
          step: index,
          ...(step.alias ? { alias: step.alias } : {}),
          receipt: this.rejected(
            ctx,
            `${receiptId}.${index}`,
            command.id,
            command.version,
            withStep(info, index),
          ),
        };
        return this.batchRejected(ctx, receiptId, 'atomic', [...stepReceipts, failed], {
          ...info,
          message: `batch not applied; step ${index} (${command.id}) failed: ${info.message}`,
          details: { ...(info.details ?? {}), step: index },
        });
      }
    }

    const target: TargetInfo = this.target(ctx);
    if (working === original) {
      return {
        schema: 'varve.batch-receipt/1',
        receiptId,
        mode: 'atomic',
        outcome: 'no-op',
        summary: 'Batch changed nothing.',
        target,
        revision: { before: revisionBefore, after: revisionBefore },
        steps: stepReceipts,
        created: [],
        changed: [],
        deleted: [],
        idMap: mergeIdMaps(stepReceipts),
        durable: { saved: false },
      };
    }

    const touched = touchedBetween(original, working);
    const created = [...touched.nodes].filter((id) => !(id in original.nodes));
    const deleted = [...touched.nodes].filter((id) => !(id in working.nodes));
    const changed = [...touched.nodes].filter((id) => id in original.nodes && id in working.nodes);

    if (dryRun) {
      return {
        schema: 'varve.batch-receipt/1',
        receiptId,
        mode: 'atomic',
        outcome: 'preview',
        summary: `Would apply ${steps.length} step(s): ${describeSets({ created, changed, deleted })}. Nothing was changed.`,
        target,
        revision: { before: revisionBefore, after: revisionBefore },
        steps: stepReceipts,
        created,
        changed,
        deleted,
        idMap: mergeIdMaps(stepReceipts),
        durable: { saved: false },
      };
    }

    const refused = await this.requireApproval(
      ctx,
      { id: 'batch', title: 'Batch', effect: 'mutate', authorization: 'edit' } as Command,
      receiptId,
      { steps: steps.map((step) => ({ command: step.command, args: step.args })) },
      revisionBefore,
      { label: `Batch (${steps.length} steps)`, created, changed, deleted },
    );
    if (refused) return this.batchRejected(ctx, receiptId, 'atomic', stepReceipts, refused);

    const committed = await ctx.authority.commit({
      plan: {
        doc: working,
        label: `Batch (${steps.length} steps)`,
        created,
        changed,
        deleted,
      },
      origin: originOf(ctx.principal),
      command: 'batch',
      receiptId,
      baseRevision: revisionBefore,
    });
    if (!committed.ok) {
      return this.batchRejected(
        ctx,
        receiptId,
        'atomic',
        stepReceipts,
        committed.reason === 'unavailable'
          ? errorInfo('TARGET_MISMATCH', { message: committed.message })
          : staleRevision(revisionBefore, committed.currentRevision),
      );
    }
    return {
      schema: 'varve.batch-receipt/1',
      receiptId,
      mode: 'atomic',
      outcome: 'applied',
      summary: `Applied ${steps.length} step(s) as one undo group: ${describeSets({ created, changed, deleted })} (revision ${revisionBefore} -> ${committed.revision}).`,
      target,
      revision: { before: revisionBefore, after: committed.revision },
      transactionId: committed.transactionId,
      steps: stepReceipts.map((entry) => ({
        ...entry,
        receipt: {
          ...entry.receipt,
          outcome: entry.receipt.outcome === 'preview' ? 'applied' : entry.receipt.outcome,
          transactionId: committed.transactionId,
        },
      })),
      created,
      changed,
      deleted,
      idMap: mergeIdMaps(stepReceipts),
      durable: { saved: false },
    };
  }

  private async runPartial(
    ctx: ExecutorContext,
    receiptId: string,
    steps: Array<{ command: string; args?: unknown; alias?: string }>,
    onError: 'stop' | 'continue',
    dryRun: boolean,
    revisionBefore: number,
  ): Promise<BatchReceipt> {
    const results = new Map<string, StepResult>();
    const stepReceipts: BatchStepReceipt[] = [];
    let applied = 0;
    let failed = 0;

    for (const [index, step] of steps.entries()) {
      let args: unknown;
      try {
        args = resolveRefs(step.args ?? {}, results, index);
      } catch (error) {
        const info = error instanceof CommandRejection ? error.info : internalError(error);
        const command = this.catalog.get(step.command);
        stepReceipts.push({
          step: index,
          ...(step.alias ? { alias: step.alias } : {}),
          receipt: this.rejected(
            ctx,
            `${receiptId}.${index}`,
            step.command,
            command?.version ?? 0,
            withStep(info, index),
          ),
        });
        failed += 1;
        if (onError === 'stop') break;
        continue;
      }
      const receipt = await this.executeSingle(
        ctx,
        {
          command: step.command,
          args,
          ...(dryRun ? { dryRun: true } : {}),
          ...(step.alias ? { alias: step.alias } : {}),
        },
        `${receiptId}.${index}`,
      );
      stepReceipts.push({ step: index, ...(step.alias ? { alias: step.alias } : {}), receipt });
      if (receipt.outcome === 'rejected' || receipt.outcome === 'unknown') {
        failed += 1;
        if (onError === 'stop') break;
      } else {
        if (receipt.outcome === 'applied') applied += 1;
        if (step.alias) {
          results.set(step.alias, {
            output: receipt.output,
            created: receipt.created,
            changed: receipt.changed,
            deleted: receipt.deleted,
            idMap: receipt.idMap,
          });
        }
      }
    }

    const outcome: Outcome =
      failed === 0
        ? dryRun
          ? 'preview'
          : applied > 0
            ? 'applied'
            : 'no-op'
        : applied > 0
          ? 'partial'
          : 'rejected';
    const unique = (pick: (r: Receipt) => string[]): string[] => [
      ...new Set(stepReceipts.flatMap((entry) => pick(entry.receipt))),
    ];
    return {
      schema: 'varve.batch-receipt/1',
      receiptId,
      mode: 'partial',
      outcome,
      summary:
        failed === 0
          ? `All ${stepReceipts.length} step(s) completed (${applied} changed the document).`
          : `${applied} step(s) applied, ${failed} failed; applied steps remain committed as separate undo groups.`,
      target: this.target(ctx),
      revision: { before: revisionBefore, after: ctx.authority.getRevision() },
      steps: stepReceipts,
      created: unique((r) => r.created),
      changed: unique((r) => r.changed),
      deleted: unique((r) => r.deleted),
      idMap: mergeIdMaps(stepReceipts),
      durable: { saved: false },
    };
  }

  // ── Shared pieces ─────────────────────────────────────────────────────────

  private checkSize(raw: unknown): ErrorInfo | null {
    let text: string;
    try {
      text = canonicalJson(raw);
    } catch (error) {
      return errorInfo('INVALID_ARGUMENT', {
        message: `request is not representable as JSON: ${error instanceof Error ? error.message : 'invalid value'}`,
      });
    }
    const bytes = utf8ByteLength(text);
    if (bytes > this.limits.maxRequestBytes) {
      return errorInfo('LIMIT_EXCEEDED', {
        message: `request is ${bytes} bytes; the limit is ${this.limits.maxRequestBytes}`,
        hint: 'split the work into smaller requests or batches',
      });
    }
    return null;
  }

  private unknownCommand(ctx: ExecutorContext, id: string): ErrorInfo {
    const visible = this.catalog.list({ principal: ctx.principal }).map((entry) => entry.id);
    const near = closestMatch(id, visible, 4);
    return errorInfo('UNKNOWN_COMMAND', {
      message: `no command named ${JSON.stringify(id.slice(0, 80))}`,
      hint: near
        ? `did you mean "${near}"? Use the command search to list what is available.`
        : 'use the command search to list available commands',
    });
  }

  /** Runtime, authorization, target pin and schema-version gates. */
  private gate(
    ctx: ExecutorContext,
    command: Command,
    target: { documentId?: string; generation?: string; instanceId?: string } | undefined,
    commandVersion: number | undefined,
  ): ErrorInfo | null {
    const availability = ctx.authority.availability?.();
    if (availability && !availability.ok) {
      return errorInfo(availability.code, {
        message: availability.message,
        ...(availability.hint ? { hint: availability.hint } : {}),
      });
    }
    const blocked = ctx.policy?.blockReason(command.effect) ?? null;
    if (blocked !== null) {
      return errorInfo('UNAVAILABLE', {
        message: `${command.id} is blocked: ${blocked}`,
        hint: 'the person running Varve controls this; it is re-enabled in Automation settings',
        details: { effect: command.effect },
      });
    }
    const info = ctx.authority.info();
    if (!command.runtimes.includes(info.mode)) {
      return errorInfo('UNAVAILABLE', {
        message: `${command.id} is not available in ${info.mode} mode`,
        hint: `available in: ${command.runtimes.join(', ')}`,
        details: { runtime: info.mode, runtimes: [...command.runtimes] },
      });
    }
    if (!ctx.principal.grants.includes(command.authorization)) {
      return errorInfo('PERMISSION_DENIED', {
        message: `${command.id} requires the "${command.authorization}" permission, which this connection was not granted`,
        hint: 'permissions are granted by the person running Varve; this request cannot grant itself',
        details: { required: command.authorization, granted: [...ctx.principal.grants] },
      });
    }
    if (target?.instanceId !== undefined && target.instanceId !== info.instanceId) {
      return errorInfo('TARGET_MISMATCH', {
        message: `request targets instance ${target.instanceId}, but this session is ${info.instanceId}`,
        hint: 'attach again and use the instance id returned by the session info command',
        details: { expected: target.instanceId, actual: info.instanceId },
      });
    }
    if (target?.generation !== undefined && target.generation !== info.generation) {
      return errorInfo('TARGET_MISMATCH', {
        message:
          'the document session was replaced since you attached (restart, reopen, or Save As)',
        hint: 'fetch the session info again and re-plan against the current document',
        details: { expected: target.generation, actual: info.generation },
      });
    }
    if (target?.documentId !== undefined && target.documentId !== info.documentId) {
      return errorInfo('TARGET_MISMATCH', {
        message: `request targets document ${target.documentId}, but the session holds ${info.documentId}`,
        details: { expected: target.documentId, actual: info.documentId },
      });
    }
    if (commandVersion !== undefined && commandVersion !== command.version) {
      return errorInfo('SCHEMA_VERSION_MISMATCH', {
        message: `${command.id} is at version ${command.version}; the request was built for version ${commandVersion}`,
        hint: `fetch the current schema with "describe ${command.id}"`,
        details: { current: command.version, requested: commandVersion },
      });
    }
    return null;
  }

  private checkIdempotency(
    ctx: ExecutorContext,
    documentId: string,
    key: string | undefined,
    attempt: number | undefined,
    operation: string,
    argsHash: string,
  ):
    | { kind: 'proceed' }
    | { kind: 'replay'; receipt: Receipt | BatchReceipt }
    | { kind: 'error'; error: ErrorInfo; outcome: Outcome } {
    if (key === undefined) return { kind: 'proceed' };
    const entry = this.idempotency.lookup(idempotencyScope(ctx.principal), documentId, key);
    if (entry) {
      if (entry.argsHash !== argsHash || entry.operation !== operation) {
        return {
          kind: 'error',
          outcome: 'rejected',
          error: errorInfo('IDEMPOTENCY_MISMATCH', {
            message: `idempotency key ${JSON.stringify(key)} was already used for a different request`,
            hint: 'use a fresh key for a different operation; reuse a key only to retry the identical request',
          }),
        };
      }
      return { kind: 'replay', receipt: entry.receipt };
    }
    if ((attempt ?? 1) > 1) {
      return {
        kind: 'error',
        outcome: 'unknown',
        error: errorInfo('OUTCOME_UNKNOWN', {
          message: `this is retry ${attempt} for key ${JSON.stringify(key)}, but no record of the original attempt exists (it may never have arrived, or the record expired or the session restarted)`,
          hint: 'inspect the document revision and history to see whether the change landed before sending it again with a new key',
        }),
      };
    }
    return { kind: 'proceed' };
  }

  private commandContext(ctx: ExecutorContext): CommandContext {
    return {
      principal: ctx.principal,
      defaultParentId: ctx.defaultParentId
        ? ctx.defaultParentId()
        : defaultInsertionParent(ctx.authority.getDocument()),
      now: ctx.now ?? Date.now,
      ...(ctx.rng ? { rng: ctx.rng } : {}),
    };
  }

  private evaluate(
    command: Command,
    args: unknown,
    doc: Document,
    cctx: CommandContext,
    authority: DocumentAuthority,
  ): Evaluated {
    if (command.effect === 'read' && command.inspect) {
      const output = command.inspect(authority, args, cctx);
      this.assertOutput(command, output);
      return {
        doc,
        output,
        label: command.title,
        warnings: [],
        mutating: false,
        created: [],
        changed: [],
        deleted: [],
      };
    }
    if (command.effect === 'read' && command.query) {
      const output = command.query(doc, args, cctx);
      this.assertOutput(command, output);
      return {
        doc,
        output,
        label: command.title,
        warnings: [],
        mutating: false,
        created: [],
        changed: [],
        deleted: [],
      };
    }
    if (command.effect === 'mutate' && command.plan) {
      const plan = command.plan(doc, args, cctx);
      this.assertOutput(command, plan.output);
      return {
        doc: plan.doc,
        output: plan.output,
        label: plan.label,
        warnings: plan.warnings ?? [],
        ...(plan.summary !== undefined ? { summary: plan.summary } : {}),
        ...(plan.noOp !== undefined ? { noOp: plan.noOp } : {}),
        mutating: true,
        created: plan.created ?? [],
        changed: plan.changed ?? [],
        deleted: plan.deleted ?? [],
      };
    }
    throw new CommandRejection('UNAVAILABLE', {
      message: `${command.id} has no implementation in this runtime`,
    });
  }

  private assertOutput(command: Command, output: unknown): void {
    const checked = validateUnknown(command.output, output, { maxNodes: 2_000_000, maxDepth: 32 });
    if (!checked.ok) {
      throw new CommandRejection('INTERNAL', {
        message: `${command.id} produced a result that violates its own output schema (${checked.issues[0]?.path || '/'}: ${checked.issues[0]?.message})`,
      });
    }
  }

  /** Authoritative id sets from the documents, ordered by what the command reported. */
  private exactSets(
    before: Document,
    evaluated: Evaluated,
  ): { created: string[]; changed: string[]; deleted: string[] } {
    const touched = touchedBetween(before, evaluated.doc);
    const created = [...touched.nodes].filter((id) => !(id in before.nodes));
    const deleted = [...touched.nodes].filter((id) => !(id in evaluated.doc.nodes));
    const changed = [...touched.nodes].filter(
      (id) => id in before.nodes && id in evaluated.doc.nodes,
    );
    const order = (ids: string[], hint: string[]): string[] => {
      const rank = new Map(hint.map((id, index) => [id, index]));
      return ids
        .slice()
        .sort(
          (a, b) =>
            (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
            a.localeCompare(b),
        )
        .slice(0, this.limits.maxReceiptIds);
    };
    return {
      created: order(created, evaluated.created),
      changed: order(changed, evaluated.changed),
      deleted: order(deleted, evaluated.deleted),
    };
  }

  private target(ctx: ExecutorContext): TargetInfo {
    const info = ctx.authority.info();
    return {
      mode: info.mode,
      instanceId: info.instanceId,
      generation: info.generation,
      documentId: info.documentId,
      documentName: info.documentName,
    };
  }

  private baseReceipt(
    ctx: ExecutorContext,
    receiptId: string,
    command: Command,
    defaulted: string[],
  ): Receipt {
    const revision = ctx.authority.getRevision();
    return {
      schema: RECEIPT_SCHEMA,
      receiptId,
      command: command.id,
      commandVersion: command.version,
      outcome: 'ok',
      summary: '',
      target: this.target(ctx),
      revision: { before: revision, after: revision },
      created: [],
      changed: [],
      deleted: [],
      idMap: {},
      warnings: [],
      defaulted,
      durable: { saved: false },
    };
  }

  private rejected(
    ctx: ExecutorContext,
    receiptId: string,
    command: string,
    commandVersion: number,
    error: ErrorInfo,
    outcome: Outcome = 'rejected',
  ): Receipt {
    const revision = ctx.authority.getRevision();
    return {
      schema: RECEIPT_SCHEMA,
      receiptId,
      command,
      commandVersion,
      outcome,
      summary: `Not applied: ${error.message}`,
      target: this.target(ctx),
      revision: { before: revision, after: revision },
      created: [],
      changed: [],
      deleted: [],
      idMap: {},
      warnings: [],
      defaulted: [],
      error,
      durable: { saved: false },
    };
  }

  private batchRejected(
    ctx: ExecutorContext,
    receiptId: string,
    mode: 'atomic' | 'partial',
    steps: BatchStepReceipt[],
    error: ErrorInfo,
    outcome: Outcome = 'rejected',
  ): BatchReceipt {
    const revision = ctx.authority.getRevision();
    return {
      schema: 'varve.batch-receipt/1',
      receiptId,
      mode,
      outcome,
      summary: `Not applied: ${error.message}`,
      target: this.target(ctx),
      revision: { before: revision, after: revision },
      steps,
      created: [],
      changed: [],
      deleted: [],
      idMap: {},
      error,
      durable: { saved: false },
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function commandNameOf(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).command;
    if (typeof name === 'string') return name.slice(0, 128);
  }
  return 'unknown';
}

function originOf(principal: Principal): Origin {
  return {
    principalId: principal.id,
    kind: principal.kind,
    label: principal.label,
    transport: principal.transport,
  };
}

function hashArgs(operation: string, args: unknown): string {
  return sha256Utf8(`${operation}\n${canonicalJson(args)}`);
}

function aliasMap(alias: string | undefined, created: string[]): Record<string, string> {
  if (alias === undefined || created.length === 0) return {};
  if (created.length === 1) return { [alias]: created[0] as string };
  return Object.fromEntries(created.map((id, index) => [`${alias}#${index}`, id]));
}

function mergeIdMaps(steps: BatchStepReceipt[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of steps) Object.assign(out, step.receipt.idMap);
  return out;
}

function describeSets(sets: { created: string[]; changed: string[]; deleted: string[] }): string {
  const parts: string[] = [];
  if (sets.created.length > 0) parts.push(`${sets.created.length} created`);
  if (sets.changed.length > 0) parts.push(`${sets.changed.length} changed`);
  if (sets.deleted.length > 0) parts.push(`${sets.deleted.length} deleted`);
  return parts.length > 0 ? parts.join(', ') : 'no entities';
}

function staleRevision(expected: number, current: number): ErrorInfo {
  return errorInfo('REVISION_CONFLICT', {
    message: `the document is at revision ${current}, not ${expected}; it changed since you last read it`,
    hint: 'read the document again (query commands return the current revision) and re-plan; do not blindly re-send',
    details: { expected, current },
  });
}

function withStep(info: ErrorInfo, step: number): ErrorInfo {
  return { ...info, details: { ...(info.details ?? {}), step } };
}

function internalError(error: unknown): ErrorInfo {
  // A short message is kept because "internal error" alone is not actionable
  // (for example an invalid ordering key in the document). Stack traces are
  // never returned, and the text is bounded.
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`.replace(/\s+/g, ' ').slice(0, 200)
      : '';
  const code: ErrorCode = 'INTERNAL';
  return errorInfo(code, {
    message: `internal error while executing the command${detail ? ` (${detail})` : ''}`,
    hint: 'the document was not changed; report this with the receipt id',
  });
}

/**
 * Replace `{ "$ref": "alias#/json/pointer" }` with a primitive from an earlier
 * step's result. Not an expression language: no operators, no eval.
 */
export function resolveRefs(
  value: unknown,
  results: ReadonlyMap<string, StepResult>,
  step: number,
  depth = 0,
): unknown {
  if (depth > 16) {
    throw new CommandRejection('LIMIT_EXCEEDED', {
      message: `step ${step}: arguments nest too deeply`,
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, results, step, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.includes('$ref')) {
    if (keys.length !== 1 || typeof record.$ref !== 'string') {
      throw new CommandRejection('INVALID_ARGUMENT', {
        message: `step ${step}: a $ref must be an object with exactly one string "$ref" property`,
        details: { step },
      });
    }
    return lookupRef(record.$ref, results, step);
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = resolveRefs(record[key], results, step, depth + 1);
  return out;
}

function lookupRef(ref: string, results: ReadonlyMap<string, StepResult>, step: number): unknown {
  const hash = ref.indexOf('#');
  const alias = hash < 0 ? ref : ref.slice(0, hash);
  const pointer = hash < 0 ? '' : ref.slice(hash + 1);
  const result = results.get(alias);
  if (!result) {
    throw new CommandRejection('INVALID_ARGUMENT', {
      message: `step ${step}: $ref ${JSON.stringify(ref)} names no earlier step alias`,
      hint: 'a step can only reference an alias defined on a step before it',
      details: { step },
    });
  }
  let cursor: unknown = result;
  for (const raw of pointer.split('/').slice(1)) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor as object, part)) {
      throw new CommandRejection('INVALID_ARGUMENT', {
        message: `step ${step}: $ref ${JSON.stringify(ref)} does not resolve`,
        details: { step },
      });
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (typeof cursor !== 'string' && typeof cursor !== 'number' && typeof cursor !== 'boolean') {
    throw new CommandRejection('INVALID_ARGUMENT', {
      message: `step ${step}: $ref ${JSON.stringify(ref)} must resolve to a string, number or boolean`,
      details: { step },
    });
  }
  return cursor;
}
