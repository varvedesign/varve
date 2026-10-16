/**
 * Properties of the command layer, checked over generated inputs.
 *
 * Example tests say a thing works for the inputs somebody thought of. These say
 * it for the inputs nobody did, and fast-check prints the shrunk counterexample
 * and its seed on failure so a failing case is a reproduction, not an anecdote.
 * To replay one: `fc.assert(property, { seed: <seed>, path: "<path>" })`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStrictJson } from '../json';
import { canonicalJson } from '../text';
import { makeSession, principal } from './harness';

/** Nodes a fresh document already has (its root group), so counts mean "added". */
const baselineNodes = (s: ReturnType<typeof makeSession>): number =>
  Object.keys(s.doc().nodes).length;

const RUNS = Number(process.env.VARVE_PROPERTY_RUNS ?? 60);
const options = { numRuns: RUNS };

/** JSON values that survive a round trip: no `__proto__` key, no -0 oddities. */
const jsonValue = fc
  .jsonValue({ maxDepth: 4 })
  .filter((value) => !JSON.stringify(value).includes('"__proto__"'));

const coordinate = fc.integer({ min: -100_000, max: 100_000 });
const size = fc.integer({ min: 1, max: 5_000 });

const rectArgs = fc.record({
  kind: fc.constant('rect' as const),
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
});

describe('strict JSON agrees with JSON.parse wherever JSON.parse is unambiguous', () => {
  it('never drops, reorders or alters a value that JSON.stringify produced', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const text = JSON.stringify(value);
        const parsed = parseStrictJson(text);
        expect(parsed.ok, text).toBe(true);
        if (parsed.ok) expect(JSON.parse(JSON.stringify(parsed.value))).toEqual(JSON.parse(text));
      }),
      options,
    );
  });

  it('refuses a duplicated key that JSON.parse would silently resolve', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }).filter((k) => k !== '__proto__'),
        fc.integer(),
        fc.integer(),
        (key, a, b) => {
          const text = `{${JSON.stringify(key)}:${a},${JSON.stringify(key)}:${b}}`;
          const parsed = parseStrictJson(text);
          expect(parsed.ok, text).toBe(false);
          if (!parsed.ok) expect(parsed.error.code).toBe('duplicate_key');
        },
      ),
      options,
    );
  });

  it('canonical JSON is independent of key order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer(), { maxKeys: 8 }),
        (record) => {
          const entries = Object.entries(record);
          const reversed = Object.fromEntries([...entries].reverse());
          expect(canonicalJson(record)).toBe(canonicalJson(reversed));
        },
      ),
      options,
    );
  });
});

describe('validation: nothing is guessed', () => {
  it('rejects any extra key on an otherwise valid request, and changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        rectArgs,
        fc
          .string({ minLength: 1, maxLength: 10 })
          .filter(
            (k) =>
              !['kind', 'x', 'y', 'width', 'height', '__proto__'].includes(k) &&
              /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) &&
              ![
                'parentId',
                'index',
                'name',
                'fill',
                'opacity',
                'cornerRadius',
                'stroke',
                'strokeWidth',
                'text',
                'fontSize',
                'rotation',
                'visible',
                'locked',
              ].includes(k),
          ),
        async (args, extra) => {
          const s = makeSession();
          const before = s.authority.getRevision();
          const r = await s.run('varve.node.create', { ...args, [extra]: 1 });
          expect(r.outcome, extra).toBe('rejected');
          expect(r.error?.code).toBe('INVALID_ARGUMENT');
          expect(s.authority.getRevision()).toBe(before);
        },
      ),
      options,
    );
  });

  it('never clamps: an out-of-range size is rejected, not corrected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 1_000_001 })),
        async (bad) => {
          const s = makeSession();
          const base = baselineNodes(s);
          const r = await s.run('varve.node.create', {
            kind: 'rect',
            x: 0,
            y: 0,
            width: bad,
            height: 10,
          });
          expect(r.outcome, String(bad)).toBe('rejected');
          expect(baselineNodes(s)).toBe(base);
        },
      ),
      options,
    );
  });
});

describe('what a created rectangle is, is what was asked for', () => {
  it('places and sizes it exactly, with no coercion', async () => {
    await fc.assert(
      fc.asyncProperty(rectArgs, async (args) => {
        const s = makeSession();
        const r = await s.run('varve.node.create', args);
        expect(r.outcome, JSON.stringify(args)).toBe('applied');
        const id = r.created[0] as string;
        const node = s.doc().nodes[id] as unknown as {
          shape: { kind: string; w: number; h: number };
          transform: number[];
        };
        expect(node.shape.kind).toBe('rect');
        expect(node.shape.w).toBe(args.width);
        expect(node.shape.h).toBe(args.height);
        // The translation is the position the caller gave, parent-local.
        expect(node.transform[4]).toBe(args.x);
        expect(node.transform[5]).toBe(args.y);
      }),
      options,
    );
  });

  it('revision moves forward by exactly one per applied command and never on a rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            rectArgs.map((a) => ({ valid: true as const, a })),
            fc.constant({ valid: false as const }),
          ),
          {
            minLength: 1,
            maxLength: 12,
          },
        ),
        async (plan) => {
          const s = makeSession();
          let expected = s.authority.getRevision();
          for (const step of plan) {
            const r = await s.run(
              'varve.node.create',
              step.valid ? step.a : { kind: 'rect', x: 0, y: 0, width: -1, height: 1 },
            );
            if (step.valid) {
              expected += 1;
              expect(r.outcome).toBe('applied');
            } else {
              expect(r.outcome).toBe('rejected');
            }
            expect(s.authority.getRevision()).toBe(expected);
          }
        },
      ),
      options,
    );
  });
});

describe('atomic batches are all-or-nothing', () => {
  const step = rectArgs.map((args) => ({ command: 'varve.node.create', args }));
  const badStep = fc.constant({
    command: 'varve.node.create',
    args: { kind: 'rect', x: 0, y: 0, width: 0, height: 1 },
  });

  it('a batch with one invalid step leaves the document byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(step, { minLength: 1, maxLength: 8 }),
        fc.nat({ max: 8 }),
        badStep,
        async (good, at, bad) => {
          const s = makeSession();
          const before = JSON.stringify(s.doc());
          const revision = s.authority.getRevision();
          const steps = [...good];
          steps.splice(Math.min(at, steps.length), 0, bad);
          const r = await s.executor.executeBatch(s.ctx, { mode: 'atomic', steps });
          expect(r.outcome).toBe('rejected');
          expect(JSON.stringify(s.doc())).toBe(before);
          expect(s.authority.getRevision()).toBe(revision);
        },
      ),
      options,
    );
  });

  it('a valid batch is one undo group however many steps it has', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 10 }), async (steps) => {
        const s = makeSession();
        const r = await s.executor.executeBatch(s.ctx, { mode: 'atomic', steps });
        expect(r.outcome).toBe('applied');
        expect(r.created).toHaveLength(steps.length);
        const history = await s.run('varve.history.list', {});
        const txs = (history.output as { transactions: unknown[] }).transactions;
        expect(txs).toHaveLength(1);
      }),
      options,
    );
  });
});

describe('idempotency is scoped to who asked, where, and with what', () => {
  const key = fc.stringMatching(/^[A-Za-z0-9._:-]{1,24}$/);

  it('the same key and arguments replay without a second edit', async () => {
    await fc.assert(
      fc.asyncProperty(key, rectArgs, async (k, args) => {
        const s = makeSession();
        const base = baselineNodes(s);
        const first = await s.run('varve.node.create', args, { idempotencyKey: k });
        const again = await s.run('varve.node.create', args, { idempotencyKey: k, attempt: 2 });
        expect(first.outcome).toBe('applied');
        expect(again.idempotency?.replayed).toBe(true);
        expect(again.created).toEqual(first.created);
        expect(baselineNodes(s)).toBe(base + 1);
      }),
      options,
    );
  });

  it('the same key with different arguments is refused, not executed', async () => {
    await fc.assert(
      fc.asyncProperty(key, rectArgs, rectArgs, async (k, a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        const s = makeSession();
        const base = baselineNodes(s);
        await s.run('varve.node.create', a, { idempotencyKey: k });
        const second = await s.run('varve.node.create', b, { idempotencyKey: k });
        expect(second.outcome).toBe('rejected');
        expect(second.error?.code).toBe('IDEMPOTENCY_MISMATCH');
        expect(baselineNodes(s)).toBe(base + 1);
      }),
      options,
    );
  });

  it("another principal using the same key is independent, never a replay of someone else's edit", async () => {
    await fc.assert(
      fc.asyncProperty(key, rectArgs, async (k, args) => {
        const s = makeSession();
        const base = baselineNodes(s);
        const a = principal('agent-a', ['read', 'edit']);
        const b = principal('agent-b', ['read', 'edit']);
        const ra = await s.executor.execute(s.as(a), {
          command: 'varve.node.create',
          args,
          idempotencyKey: k,
        });
        const rb = await s.executor.execute(s.as(b), {
          command: 'varve.node.create',
          args,
          idempotencyKey: k,
        });
        expect(ra.outcome).toBe('applied');
        expect(rb.outcome).toBe('applied');
        expect(rb.idempotency?.replayed).toBe(false);
        expect(baselineNodes(s)).toBe(base + 2);
      }),
      options,
    );
  });

  it('a retry that declares itself finds no record and is reported unknown, never re-run', async () => {
    await fc.assert(
      fc.asyncProperty(key, rectArgs, async (k, args) => {
        const s = makeSession();
        const base = baselineNodes(s);
        const r = await s.run('varve.node.create', args, { idempotencyKey: k, attempt: 2 });
        expect(r.outcome).not.toBe('applied');
        expect(baselineNodes(s)).toBe(base);
      }),
      options,
    );
  });
});

describe('rolling back your own changes restores what was there', () => {
  it('reversing a sequence of agent edits newest-first returns the original nodes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rectArgs, { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 4 }),
        async (rects, renameAt) => {
          const s = makeSession();
          const original = JSON.stringify(s.doc().nodes);
          const transactions: string[] = [];
          const ids: string[] = [];
          for (const args of rects) {
            const r = await s.run('varve.node.create', args);
            expect(r.outcome).toBe('applied');
            ids.push(r.created[0] as string);
            transactions.push(r.transactionId as string);
          }
          for (const index of renameAt) {
            const id = ids[index % ids.length] as string;
            const r = await s.run('varve.node.set', { nodeIds: [id], opacity: 0.5 });
            if (r.outcome === 'applied' && r.transactionId) transactions.push(r.transactionId);
          }
          for (const tx of [...transactions].reverse()) {
            const back = await s.run('varve.history.rollback', { transactionId: tx });
            expect(back.outcome, back.summary).toBe('applied');
          }
          expect(JSON.stringify(s.doc().nodes)).toBe(original);
        },
      ),
      { numRuns: Math.max(20, Math.floor(RUNS / 2)) },
    );
  });
});
