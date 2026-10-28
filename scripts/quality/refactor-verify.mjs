#!/usr/bin/env node
/**
 * Declaration-preservation verifier for code-motion refactors (Varve).
 *
 * Usage:
 *   node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> \
 *     [--dest <dir> ...] [--json]
 *
 * The remediation templates require proof that an extraction dropped no
 * declaration (the generic template names a Go-era "refactor_verify"). This
 * verifier compares the top-level declarations of the target file at the base
 * revision with the union of top-level declarations in the current target plus
 * every source file under each destination directory. Top-level includes
 * function, class, interface, type alias, enum and module/namespace
 * declarations plus every variable binding (destructuring included); a
 * declaration may move to any after file. Exported names must survive
 * somewhere in the after set (export modifier, named export list, namespace
 * export or default export), so a moved-and-still-exported declaration keeps
 * the verification green even before a barrel re-export exists.
 *
 * Exit codes: 0 declarations and exports preserved; 1 a declaration or exported
 * name is missing; 2 usage or IO/parse error.
 *
 * Limits: TypeScript/JavaScript only; Rust test/fixture files are verified by
 * their package test suite instead. `export *` wildcards are not resolved: a
 * name re-exported only through `export *` must also appear in a named export.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import ts from 'typescript';
import { isMainModule } from '../is-main-module.mjs';

/** Source extensions parsed in the after set (target plus destinations). */
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

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'target', '.git']);
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_EXPORT = 'default';

/** Invalid command-line usage; reported with the usage text and exit 2. */
export class UsageError extends Error {}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scriptKindFor(fileName) {
  const extension = extname(fileName);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const detail = ts.flattenDiagnosticMessageText(sourceFile.parseDiagnostics[0].messageText, ' ');
    throw new Error(`cannot parse ${fileName}: ${detail}`);
  }
  return sourceFile;
}

function hasModifier(statement, kind) {
  if (!ts.canHaveModifiers(statement)) return false;
  const modifiers = ts.getModifiers(statement);
  return modifiers?.some((modifier) => modifier.kind === kind) === true;
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

/** Declaration names introduced directly by one top-level statement. */
function declarationNamesOf(statement) {
  if (ts.isVariableStatement(statement)) {
    const names = [];
    for (const declaration of statement.declarationList.declarations) {
      bindingNames(declaration.name, (name) => names.push(name));
    }
    return names;
  }
  if (ts.isModuleDeclaration(statement)) return [statement.name.text];
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  return [];
}

/**
 * Collect the top-level declaration names and exported names of one source
 * text. Exported names include "default" for a default export.
 */
export function collectSurface(source, fileName) {
  const sourceFile = parseSource(source, fileName);
  const declarations = new Set();
  const exported = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) exported.add(element.name.text);
      } else if (clause !== undefined && ts.isNamespaceExport(clause)) {
        exported.add(clause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      const exportEquals =
        statement.isExportEquals === true || statement.isExportAssignment === true;
      if (!exportEquals) exported.add(DEFAULT_EXPORT);
      continue;
    }
    const names = declarationNamesOf(statement);
    for (const name of names) declarations.add(name);
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const name of names) exported.add(name);
    }
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) exported.add(DEFAULT_EXPORT);
  }
  return { declarations: [...declarations], exported: [...exported] };
}

/** Top-level declaration names of one source text. */
export function declarationNames(source, fileName) {
  return collectSurface(source, fileName).declarations;
}

/** Names one source text exports, including "default" for a default export. */
export function exportedNames(source, fileName) {
  return collectSurface(source, fileName).exported;
}

/** Recursively list source files under one destination directory. */
export function collectSourceFiles(directory) {
  const files = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      comparePaths(left.name, right.name),
    );
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(full);
      }
    }
  };
  walk(directory);
  return files;
}

/**
 * Pure comparison used by the CLI and its tests. The after set is the current
 * target plus every destination source: a declaration, and a name exported
 * before, may live in any of them.
 * @param {{baseSource:string,baseName:string,targetSource:string,targetName:string,destSources:Array<{source:string,name:string}>}} input
 */
export function verifyDeclarations(input) {
  const base = collectSurface(input.baseSource, input.baseName);
  const present = new Set();
  const exported = new Set();
  for (const file of [
    { source: input.targetSource, name: input.targetName },
    ...input.destSources,
  ]) {
    const surface = collectSurface(file.source, file.name);
    for (const name of surface.declarations) present.add(name);
    for (const name of surface.exported) exported.add(name);
  }
  const missing = base.declarations.filter((name) => !present.has(name)).sort(comparePaths);
  const missingExports = base.exported.filter((name) => !exported.has(name)).sort(comparePaths);
  return {
    ok: missing.length === 0 && missingExports.length === 0,
    baseCount: base.declarations.length,
    presentCount: present.size,
    missing,
    missingExports,
  };
}

function readBaseFile(root, ref, target) {
  try {
    return execFileSync('git', ['show', `${ref}:${target}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    const detail = String(error.stderr ?? '').trim();
    throw new Error(`cannot read ${target} at ${ref}${detail.length > 0 ? `: ${detail}` : ''}`);
  }
}

function loadDestSources(root, dests) {
  const sources = [];
  for (const dest of dests) {
    const absolute = resolve(root, dest);
    let files;
    try {
      files = collectSourceFiles(absolute);
    } catch (error) {
      throw new Error(`cannot read --dest ${dest}: ${error.message}`);
    }
    for (const file of files) sources.push({ name: file, source: readFileSync(file, 'utf8') });
  }
  return sources;
}

function usageText() {
  return [
    'Declaration-preservation verifier for code-motion refactors.',
    '',
    'Usage:',
    '  node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> \\',
    '    [--dest <dir> ...] [--json]',
    '',
    'Options:',
    '  --base <ref>     Git revision holding the pre-move target file',
    '  --target <path>  Repository-relative file that held the declarations',
    '  --dest <dir>     Destination directory receiving moved declarations; repeatable',
    '  --json           Print one machine-readable JSON object',
    '  --help, -h       Print this usage and exit 0',
    '',
    'Exit codes: 0 declarations and exports preserved; 1 a declaration or',
    'exported name is missing; 2 usage or IO/parse error.',
  ].join('\n');
}

/**
 * Parse CLI arguments into options. Throws UsageError for invalid combinations.
 * @param {string[]} argv
 */
export function parseArguments(argv) {
  const options = { base: null, target: null, dests: [], json: false, help: false };
  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--base') {
      if (options.base !== null) throw new UsageError('--base may be given only once');
      options.base = readValue(argument, index);
      index += 1;
    } else if (argument === '--target') {
      if (options.target !== null) throw new UsageError('--target may be given only once');
      options.target = readValue(argument, index);
      index += 1;
    } else if (argument === '--dest') {
      options.dests.push(readValue(argument, index));
      index += 1;
    } else {
      throw new UsageError(`unknown argument: ${argument}`);
    }
  }
  if (options.help) return options;
  if (options.base === null || options.target === null) {
    throw new UsageError('missing --base <git-ref> or --target <path>');
  }
  return options;
}

/**
 * CLI entry point.
 * @param {string} [cwd]
 * @param {string[]} [argv]
 * @returns {number} exit code
 */
export function runRefactorVerify(cwd = process.cwd(), argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`refactor-verify: ${message}`);
    console.error(usageText());
    return 2;
  }
  if (options.help) {
    console.log(usageText());
    return 0;
  }
  let result;
  try {
    const baseSource = readBaseFile(cwd, options.base, options.target);
    let targetSource = '';
    try {
      targetSource = readFileSync(resolve(cwd, options.target), 'utf8');
    } catch {
      if (options.dests.length === 0) {
        throw new Error(`cannot read target ${options.target} and no --dest was given`);
      }
    }
    const destSources = loadDestSources(cwd, options.dests);
    result = verifyDeclarations({
      baseSource,
      baseName: options.target,
      targetSource,
      targetName: options.target,
      destSources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`refactor-verify: ${message}`);
    return 2;
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `refactor-verify OK: ${result.baseCount} declaration(s) preserved (${result.presentCount} found across the target and destination).`,
    );
  } else {
    if (result.missing.length > 0) {
      console.error(`Missing declaration(s): ${result.missing.join(', ')}`);
    }
    if (result.missingExports.length > 0) {
      console.error(`Missing exported name(s): ${result.missingExports.join(', ')}`);
    }
  }
  return result.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runRefactorVerify(process.cwd());
}
