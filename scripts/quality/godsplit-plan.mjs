#!/usr/bin/env node
/**
 * God-file seam planner (Varve).
 *
 * Lists the top-level declarations of a source file with their line ranges,
 * doc-comment summary, export status and standalone size. The execution
 * template (remediation/prompts/02-SEAM-EXECUTION-TEMPLATE.md) requires a
 * planner instead of hand-invented cut lines; this is the repo-native one.
 *
 * Usage:
 *   node scripts/quality/godsplit-plan.mjs <file.ts|tsx|js|jsx|mjs|...> [--json]
 *
 * Exit codes: 0 plan printed; 2 unreadable/unsupported input or bad usage.
 *
 * The planner is intentionally read-only. It never suggests destinations: the
 * seam (which declarations are one concern) is a review decision.
 */
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { isMainModule } from '../is-main-module.mjs';

/** File-size cap and the split target the budget policy uses. */
export const OVER_CAP = 400;
export const SUB_SPLIT_LINES = 350;

/** Source extensions the planner can map to a TypeScript script kind. */
export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Invalid command-line usage; reported with the usage text and exit 2. */
export class UsageError extends Error {}

function countLines(source) {
  if (source.length === 0) return 0;
  const segments = source.split('\n').length;
  return source.endsWith('\n') ? segments - 1 : segments;
}

function scriptKindFor(extension) {
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function docFirstLine(source, node) {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  if (ranges.length === 0) return '';
  const range = ranges[ranges.length - 1];
  const raw = source.slice(range.pos, range.end);
  const body = raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
  return body[0] ?? '';
}

/** Every identifier a variable-declaration binding pattern introduces. */
function bindingNames(pattern, visit) {
  if (ts.isIdentifier(pattern)) {
    visit(pattern.text);
    return;
  }
  if (!ts.isObjectBindingPattern(pattern) && !ts.isArrayBindingPattern(pattern)) return;
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, visit);
  }
}

function declarationName(statement) {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name === undefined ? '(anonymous)' : statement.name.text;
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name.text;
  }
  if (ts.isModuleDeclaration(statement)) return statement.name.text;
  if (ts.isVariableStatement(statement)) {
    const names = [];
    for (const declaration of statement.declarationList.declarations) {
      bindingNames(declaration.name, (name) => names.push(name));
    }
    return names.join(', ');
  }
  return '';
}

function blockKind(statement) {
  if (ts.isVariableStatement(statement)) return 'Variable';
  if (ts.isExportAssignment(statement)) return 'ExportAssignment';
  return ts.SyntaxKind[statement.kind].replace('Declaration', '').replace('Statement', '');
}

function isExported(statement) {
  if (ts.isExportAssignment(statement)) {
    const exportEquals = statement.isExportEquals === true || statement.isExportAssignment === true;
    return !exportEquals;
  }
  if (!ts.canHaveModifiers(statement)) return false;
  const modifiers = ts.getModifiers(statement) ?? [];
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
}

/**
 * Build a structural plan for one file.
 * @param {string} filePath
 * @returns {{file:string,totalLines:number,imports:number,blocks:Array<object>,hazards:string[],unsupported:boolean}}
 */
export function planGodFile(filePath) {
  const extension = extname(filePath);
  const source = readFileSync(filePath, 'utf8');
  const totalLines = countLines(source);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return {
      file: filePath,
      totalLines,
      imports: 0,
      blocks: [],
      hazards: [`unsupported file extension: ${extension}`],
      unsupported: true,
    };
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(extension),
  );
  const blocks = [];
  let imports = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports += 1;
      continue;
    }
    if (ts.isEmptyStatement(statement)) continue;
    const startLine =
      sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
    blocks.push({
      startLine,
      endLine,
      lines: endLine - startLine + 1,
      kind: blockKind(statement),
      name: declarationName(statement),
      exported: isExported(statement),
      doc: docFirstLine(source, statement),
    });
  }
  const hazards = [];
  if (totalLines > OVER_CAP) {
    hazards.push(
      `target is over the ${OVER_CAP}-line cap: the split must leave every result at or under it`,
    );
  }
  for (const block of blocks) {
    if (block.lines > SUB_SPLIT_LINES) {
      hazards.push(
        `sub-split required: ${block.name || block.kind} lines ${block.startLine}-${block.endLine} is ${block.lines} lines on its own`,
      );
    }
  }
  return { file: filePath, totalLines, imports, blocks, hazards, unsupported: false };
}

export function formatPlan(plan) {
  const lines = [];
  lines.push(`God-file seam plan: ${plan.file}`);
  lines.push(
    `Lines: ${plan.totalLines} | imports: ${plan.imports} | blocks: ${plan.blocks.length}`,
  );
  lines.push('');
  lines.push('| lines | range | kind | name | export | first doc line |');
  lines.push('|-------|-------|------|------|--------|----------------|');
  for (const block of plan.blocks) {
    lines.push(
      `| ${block.lines} | ${block.startLine}-${block.endLine} | ${block.kind} | ${block.name || '-'} | ${block.exported ? 'yes' : 'no'} | ${block.doc || '-'} |`,
    );
  }
  if (plan.hazards.length > 0) {
    lines.push('');
    lines.push('Hazards:');
    for (const hazard of plan.hazards) lines.push(`- ${hazard}`);
  }
  return lines.join('\n');
}

function usageText() {
  return [
    'God-file seam planner.',
    '',
    'Usage:',
    '  node scripts/quality/godsplit-plan.mjs <file> [--json]',
    '',
    'Options:',
    '  --json         Print the full plan as one machine-readable JSON object',
    '  --help, -h     Print this usage and exit 0',
    '',
    'Exit codes: 0 plan printed; 2 unreadable/unsupported input or bad usage.',
  ].join('\n');
}

/**
 * Parse CLI arguments into options. Throws UsageError for invalid input.
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  const options = { file: null, json: false, help: false };
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument.startsWith('-')) throw new UsageError(`unknown argument: ${argument}`);
    else if (options.file !== null) throw new UsageError(`unexpected argument: ${argument}`);
    else options.file = argument;
  }
  if (options.help) return options;
  if (options.file === null) throw new UsageError('missing <file>');
  return options;
}

/**
 * CLI entry point.
 * @param {string} [cwd]
 * @param {string[]} [argv]
 * @returns {number} exit code
 */
export function runGodsplitPlan(cwd = process.cwd(), argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`godsplit-plan: ${message}`);
    console.error(usageText());
    return 2;
  }
  if (options.help) {
    console.log(usageText());
    return 0;
  }
  let plan;
  try {
    plan = planGodFile(resolve(cwd, options.file));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`godsplit-plan: ${message}`);
    return 2;
  }
  if (plan.unsupported) {
    console.error(`godsplit-plan: ${plan.hazards[0]}`);
    return 2;
  }
  console.log(options.json ? JSON.stringify(plan, null, 2) : formatPlan(plan));
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runGodsplitPlan(process.cwd());
}
