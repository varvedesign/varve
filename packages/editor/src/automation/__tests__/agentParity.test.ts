/**
 * Parity gate: every user-facing action the editor can dispatch is either
 * backed by a semantic command or recorded with a reason it is not one.
 *
 * The denominator is real. `createActionHandlers` is the editor's own action
 * map, so this counts what the application can actually do rather than what a
 * menu happens to list. A new action id cannot appear silently: it must be
 * classified here, in the same commit that introduces it.
 *
 * Two independent checks run:
 *
 * 1. **Inventory** — every live action id is `reviewed`, `notACommand`, or in
 *    the captured backlog. An id in none of them fails, and so does a backlog
 *    entry whose action no longer exists.
 * 2. **Catalog** — every `reviewed` target is a command the catalog really
 *    registers, every registered command is recorded in `commands`, and every
 *    test file a record names exists. This is what stops a manifest from
 *    advertising coverage that no code provides.
 *
 * Regenerate the captured inventory deliberately with
 * `VARVE_UPDATE_AGENT_PARITY=1 npx vitest run packages/editor/src/automation/__tests__/agentParity.test.ts`
 * and review the diff. CI never sets it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStandardCatalog } from '@varve/automation';
import { describe, expect, it } from 'vitest';
import { createActionHandlers } from '../../actions/createActionHandlers';
import type { EditorContextValue } from '../../context';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, '../../../../automation/parity/agent-parity.json');
const REPO_ROOT = resolve(HERE, '../../../../..');

interface CommandRecord {
  status: string;
  ui: string[];
  gesture: string[];
  preconditions: string[];
  tests: string[];
  limits?: string[];
}

interface Manifest {
  schema: string;
  updated: string;
  reasonCodes: string[];
  commands: Record<string, CommandRecord>;
  reviewed: Record<string, string>;
  notACommand: Record<string, string>;
  unmappedBacklog: { reason: string; expires: string; detail: string };
  inventoryAtCapture: string[];
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

function liveInventory(): string[] {
  // Constructing the handler map must not touch the editor: the returned
  // handlers close over `editor` and only read it when invoked. A stand-in
  // object proves it, and would throw loudly here if that ever changed.
  const handlers = createActionHandlers({} as EditorContextValue);
  return Object.keys(handlers).sort();
}

describe('agent parity manifest', () => {
  const manifest = loadManifest();
  const inventory = liveInventory();

  it('captures the real action inventory and fails on an unclassified new route', () => {
    if (process.env.VARVE_UPDATE_AGENT_PARITY === '1') {
      writeFileSync(
        MANIFEST_PATH,
        `${JSON.stringify({ ...manifest, inventoryAtCapture: inventory }, null, 2)}\n`,
      );
      return;
    }
    const captured = new Set(manifest.inventoryAtCapture);
    const classified = new Set([
      ...Object.keys(manifest.reviewed),
      ...Object.keys(manifest.notACommand),
    ]);
    const unclassifiedNew = inventory.filter((id) => !captured.has(id) && !classified.has(id));
    expect(
      unclassifiedNew,
      [
        'New editor action(s) with no parity record.',
        'Classify each one in packages/automation/parity/agent-parity.json:',
        '  reviewed[id]    = "varve.<domain>.<verb>"  when a semantic command already covers it',
        '  notACommand[id] = one of the declared reasonCodes when it is not a semantic command',
        'If it needs a command that does not exist yet, add the command first or record it as backlog debt.',
      ].join('\n'),
    ).toEqual([]);

    const capturedSet = new Set(inventory);
    const stale = manifest.inventoryAtCapture.filter((id) => !capturedSet.has(id));
    expect(stale, 'Captured inventory entries whose action no longer exists; re-capture').toEqual(
      [],
    );
  });

  it('never classifies one action in two ways', () => {
    const both = Object.keys(manifest.reviewed).filter((id) => id in manifest.notACommand);
    expect(both).toEqual([]);
  });

  it('classifies only actions the editor actually dispatches', () => {
    const live = new Set(inventory);
    const dead = [...Object.keys(manifest.reviewed), ...Object.keys(manifest.notACommand)].filter(
      (id) => !live.has(id),
    );
    // A renamed or deleted action leaves a row that looks like coverage and is not.
    expect(dead, 'Classified actions that no longer exist; remove or rename the rows').toEqual([]);
  });

  it('uses only declared reason codes', () => {
    const declared = new Set(manifest.reasonCodes);
    const unknown = Object.entries(manifest.notACommand)
      .filter(([, reason]) => !declared.has(reason))
      .map(([id, reason]) => `${id}: ${reason}`);
    expect(unknown).toEqual([]);
  });

  it('maps reviewed actions only to commands the catalog really registers', () => {
    const catalog = createStandardCatalog();
    const missing = Object.entries(manifest.reviewed)
      .filter(([, command]) => !catalog.has(command))
      .map(([action, command]) => `${action} -> ${command}`);
    expect(missing).toEqual([]);
  });

  it('records every registered command, so nothing is silently unadvertised', () => {
    const catalog = createStandardCatalog();
    const recorded = new Set(Object.keys(manifest.commands));
    const unrecorded = catalog
      .list()
      .map((command) => command.id)
      .filter((id) => !recorded.has(id));
    expect(unrecorded).toEqual([]);
    const phantom = [...recorded].filter((id) => !catalog.has(id));
    expect(phantom).toEqual([]);
  });

  it('backs every implemented command with at least one test file that exists', () => {
    const problems: string[] = [];
    for (const [id, record] of Object.entries(manifest.commands)) {
      if (record.status !== 'implemented') continue;
      if (record.tests.length === 0) problems.push(`${id} claims implemented with no test`);
      for (const test of record.tests) {
        if (!existsSync(resolve(REPO_ROOT, test)))
          problems.push(`${id} names a missing test: ${test}`);
      }
      if (record.preconditions.length === 0) {
        problems.push(`${id} records no precondition, which no document operation has none of`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the unmapped backlog dated and non-expired', () => {
    const expires = Date.parse(`${manifest.unmappedBacklog.expires}T00:00:00Z`);
    expect(Number.isFinite(expires), 'unmappedBacklog.expires must be an ISO date').toBe(true);
    expect(
      expires,
      `The unmapped-command backlog expired on ${manifest.unmappedBacklog.expires}. ` +
        'Either implement the missing commands, classify the actions, or extend the expiry deliberately.',
    ).toBeGreaterThan(Date.now());
  });

  it('reports the coverage denominators it actually measured', () => {
    const catalog = createStandardCatalog();
    const classified = new Set([
      ...Object.keys(manifest.reviewed),
      ...Object.keys(manifest.notACommand),
    ]);
    const backlog = inventory.filter((id) => !classified.has(id));
    // A readable number, printed on every run so the gap is never implied away.
    console.log(
      [
        `agent parity: ${catalog.size} commands`,
        `${Object.keys(manifest.commands).length} recorded`,
        `${Object.keys(manifest.reviewed).length}/${inventory.length} actions reviewed`,
        `${Object.keys(manifest.notACommand).length} recorded as non-commands`,
        `${backlog.length} unmapped (backlog expires ${manifest.unmappedBacklog.expires})`,
      ].join(' | '),
    );
    expect(catalog.size).toBe(Object.keys(manifest.commands).length);
  });
});
