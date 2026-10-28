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
 *   node scripts/quality/godsplit-plan.mjs <file.ts|tsx|js|jsx|mjs> [--json] [--top 40]
 *
 * Exit codes: 0 plan printed; 2 unreadable/unsupported input.
 *
 * The planner is intentionally read-only. It never suggests destinations: the
 * seam (which declarations are one concern) is a review decision.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export const OVER_CAP = 400;
export const SUB_SPLIT_LINES = 350;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SCRIPT_KINDS = {
  '.ts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
};

function docFirstLine(source, node) {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  if (ranges.length === 0) return '';
  const raw = source.slice(ranges[ranges.length - 1].pos, ranges[ranges.length - 1].end);
  const body = raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
  return body[0] ?? '';
}

function declarationName(statement, source) {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name ? statement.name.text : '(anonymous)';
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name.text;
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((declaration) => declaration.name.getText(source))
      .join(', ');
  }
  return '';
}

function isExported(statement) {
  return Boolean(
    ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
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
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return {
      file: filePath,
      totalLines: source.split('\n').length,
      imports: 0,
      blocks: [],
      hazards: ['unsupported file extension: ' + extension],
      unsupported: true,
    };
  }
  const scriptKind = SCRIPT_KINDS[extension];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
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
    const lines = endLine - startLine + 1;
    blocks.push({
      startLine,
      endLine,
      lines,
      kind: ts.SyntaxKind[statement.kind].replace('Declaration', '').replace('Statement', ''),
      name: declarationName(statement, sourceFile),
      exported: isExported(statement),
      doc: docFirstLine(source, statement),
    });
  }
  const totalLines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  const hazards = [];
  if (totalLines > OVER_CAP) {
    hazards.push(
      'target is over the ' +
        OVER_CAP +
        '-line cap: the split must leave every result at or under it',
    );
  }
  for (const block of blocks) {
    if (block.lines > SUB_SPLIT_LINES) {
      hazards.push(
        'sub-split required: ' +
          (block.name || block.kind) +
          ' lines ' +
          block.startLine +
          '-' +
          block.endLine +
          ' is ' +
          block.lines +
          ' lines on its own',
      );
    }
  }
  return { file: filePath, totalLines, imports, blocks, hazards, unsupported: false };
}

export function formatPlan(plan) {
  const lines = [];
  lines.push('God-file seam plan: ' + plan.file);
  lines.push(
    'Lines: ' +
      plan.totalLines +
      ' | imports: ' +
      plan.imports +
      ' | blocks: ' +
      plan.blocks.length,
  );
  lines.push('');
  lines.push('| lines | range | kind | name | export | first doc line |');
  lines.push('|-------|-------|------|------|--------|----------------|');
  for (const block of plan.blocks) {
    lines.push(
      '| ' +
        block.lines +
        ' | ' +
        block.startLine +
        '-' +
        block.endLine +
        ' | ' +
        block.kind +
        ' | ' +
        (block.name || '-') +
        ' | ' +
        (block.exported ? 'yes' : 'no') +
        ' | ' +
        (block.doc || '-') +
        ' |',
    );
  }
  if (plan.hazards.length > 0) {
    lines.push('');
    lines.push('Hazards:');
    for (const hazard of plan.hazards) lines.push('- ' + hazard);
  }
  return lines.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const file = argv.find((argument) => !argument.startsWith('--'));
  if (!file) {
    console.error('Usage: node scripts/quality/godsplit-plan.mjs <file> [--json]');
    return 2;
  }
  let plan;
  try {
    plan = planGodFile(resolve(file));
  } catch (error) {
    console.error('godsplit-plan: ' + (error instanceof Error ? error.message : String(error)));
    return 2;
  }
  if (plan.unsupported) {
    console.error('godsplit-plan: ' + plan.hazards[0]);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(formatPlan(plan));
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('godsplit-plan.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
