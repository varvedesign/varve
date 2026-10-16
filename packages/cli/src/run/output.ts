/**
 * Human-readable rendering of receipts and command descriptions.
 *
 * Machine consumers use `--json`, which prints the receipt object verbatim and
 * nothing else on stdout. These renderers are for people; they never carry
 * information that is absent from the structured form.
 */
import type {
  BatchReceipt,
  CommandDescription,
  CommandSummary,
  ErrorInfo,
  JsonSchema,
  Receipt,
} from '@varve/automation';

function list(label: string, ids: readonly string[], max = 8): string[] {
  if (ids.length === 0) return [];
  const shown = ids.slice(0, max).join(', ');
  const more = ids.length > max ? `, ... (+${ids.length - max} more)` : '';
  return [`  ${label.padEnd(9)} ${shown}${more}`];
}

function errorLines(error: ErrorInfo): string[] {
  const lines: string[] = [];
  for (const issue of error.issues ?? []) {
    lines.push(`  ${issue.path || '/'}: ${issue.message}${issue.hint ? ` (${issue.hint})` : ''}`);
  }
  if (error.hint) lines.push(`  hint: ${error.hint}`);
  if (error.retryable)
    lines.push('  this may succeed after the document changes; re-read and re-plan');
  return lines;
}

export function formatReceipt(
  receipt: Receipt | BatchReceipt,
  saved?: { path: string; bytes: number } | null,
): string {
  const lines: string[] = [];
  const head = receipt.error
    ? `${receipt.outcome} [${receipt.error.code}]: ${receipt.error.message}`
    : `${receipt.outcome}: ${receipt.summary}`;
  lines.push(head);
  if (receipt.error) lines.push(...errorLines(receipt.error));
  lines.push(...list('created:', receipt.created));
  lines.push(...list('changed:', receipt.changed));
  lines.push(...list('deleted:', receipt.deleted));
  const map = Object.entries(receipt.idMap);
  if (map.length > 0) lines.push(`  ids:      ${map.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if ('steps' in receipt) {
    for (const step of receipt.steps) {
      lines.push(
        `  step ${step.step}${step.alias ? ` (${step.alias})` : ''}: ${step.receipt.outcome} ${step.receipt.command}`,
      );
    }
  }
  if (saved) lines.push(`  saved:    ${saved.path} (${saved.bytes} bytes)`);
  return lines.join('\n');
}

export function formatCommandTable(commands: readonly CommandSummary[]): string {
  if (commands.length === 0) return 'no commands match';
  const idWidth = Math.max(...commands.map((c) => c.id.length));
  return commands
    .map(
      (c) =>
        `${c.id.padEnd(idWidth)}  ${c.effect.padEnd(6)} ${c.authorization.padEnd(7)} ${c.title}`,
    )
    .join('\n');
}

interface JsonProp {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  description?: string;
  default?: unknown;
  const?: unknown;
  anyOf?: JsonProp[];
  oneOf?: JsonSchema[];
  items?: JsonProp;
  maxItems?: number;
}

function typeLabel(prop: JsonProp): string {
  if (prop.enum) return prop.enum.join(' | ');
  if (prop.const !== undefined) return JSON.stringify(prop.const);
  if (prop.anyOf) return prop.anyOf.map(typeLabel).join(' | ');
  if (prop.type === 'array') return `${prop.items ? typeLabel(prop.items) : 'any'}[]`;
  let out = prop.type ?? 'any';
  if (prop.minimum !== undefined || prop.maximum !== undefined) {
    out += ` [${prop.minimum ?? ''}..${prop.maximum ?? ''}]`;
  }
  return out;
}

function schemaLines(schema: JsonSchema, indent = '  '): string[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonProp>;
  const required = new Set((schema.required ?? []) as string[]);
  const oneOf = schema.oneOf as JsonSchema[] | undefined;
  if (oneOf) {
    return oneOf.flatMap((variant, index) => [
      `${indent}variant ${index + 1}:`,
      ...schemaLines(variant, `${indent}  `),
    ]);
  }
  const lines: string[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const flag = required.has(name) ? 'required' : 'optional';
    const dflt = prop.default !== undefined ? `, default ${JSON.stringify(prop.default)}` : '';
    lines.push(`${indent}${name}: ${typeLabel(prop)} (${flag}${dflt})`);
  }
  return lines.length > 0 ? lines : [`${indent}(no arguments)`];
}

export function formatDescription(d: CommandDescription): string {
  const lines = [
    `${d.id} (version ${d.version})`,
    d.summary,
    '',
    `effect:        ${d.effect}`,
    `permission:    ${d.authorization}`,
    `runtimes:      ${d.runtimes.join(', ')}`,
    `idempotent:    ${d.naturallyIdempotent ? 'yes (same arguments, same state)' : 'no'}`,
    `schema hash:   ${d.schemaHash}`,
    '',
    'arguments:',
    ...schemaLines(d.inputSchema),
  ];
  if (d.examples.length > 0) {
    lines.push('', 'examples:');
    for (const example of d.examples) {
      lines.push(`  # ${example.title}`);
      lines.push(
        `  varve exec ${d.id} --file doc.varve --args-json '${JSON.stringify(example.args)}' --json`,
      );
    }
  }
  return lines.join('\n');
}
