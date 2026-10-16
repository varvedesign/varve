/**
 * Strict option parser for the automation commands.
 *
 * The legacy `parseArgs` treats any short token as an option, so `-5` becomes a
 * flag and the value is lost. This parser knows each command's options up
 * front: an option that takes a value consumes the next token verbatim (it may
 * start with `-`), `--` ends option parsing, unknown options are errors with a
 * suggestion, and negative numbers are positional values.
 */
import { closestMatch } from '@varve/automation';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface OptionSpec {
  /** Boolean flags, e.g. `json`. */
  flags?: readonly string[];
  /** Options that take one value, e.g. `file`. */
  values?: readonly string[];
  /** Short aliases: `{ o: 'out' }`. */
  aliases?: Readonly<Record<string, string>>;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string[]>;
  value(name: string): string | undefined;
  has(name: string): boolean;
}

const NUMERIC = /^-(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseRunArgs(argv: readonly string[], spec: OptionSpec): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  const known = [...(spec.flags ?? []), ...(spec.values ?? [])];
  const isFlag = (name: string): boolean => spec.flags?.includes(name) ?? false;
  const isValue = (name: string): boolean => spec.values?.includes(name) ?? false;

  const unknown = (token: string): never => {
    const name = token.replace(/^-+/, '').split('=')[0] ?? '';
    const near = closestMatch(name, known);
    throw new UsageError(
      `unknown option ${token.split('=')[0]}${near ? `; did you mean --${near}?` : ''}`,
    );
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === '-' || !token.startsWith('-') || NUMERIC.test(token)) {
      positionals.push(token);
      continue;
    }
    let name: string;
    let inline: string | undefined;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
      inline = eq >= 0 ? token.slice(eq + 1) : undefined;
    } else {
      const alias = spec.aliases?.[token.slice(1)];
      if (token.length !== 2 || alias === undefined) return unknown(token);
      name = alias;
    }
    if (isFlag(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} does not take a value`);
      flags.add(name);
    } else if (isValue(name)) {
      let value = inline;
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
        i += 1;
        value = argv[i] as string;
      }
      const list = values.get(name) ?? [];
      list.push(value);
      values.set(name, list);
    } else {
      unknown(token);
    }
  }

  return {
    positionals,
    flags,
    values,
    value: (name) => values.get(name)?.at(-1),
    has: (name) => flags.has(name) || values.has(name),
  };
}
