#!/usr/bin/env node
/**
 * Declaration-preservation verifier for code-motion refactors (Varve).
 *
 * Usage:
 *   node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> [--dest <dir>] [--json]
 *
 * The execution template requires proof that an extraction dropped no
 * declaration (the generic template names a Go-era "refactor_verify"). This
 * verifier compares the top-level declaration names of the target file at the
 * base revision with the union of top-level declarations in the current target
 * plus every source file under the destination directory.
 *
 * Exit codes: 0 preserved; 1 a declaration or exported name is missing;
 * 2 bad input.
 *
 * Limits: TypeScript/JavaScript only; Rust test/fixture files are verified by
 * their package test suite instead.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function declarationNames(source, fileName) {
  const extension = extname(fileName);
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.js' || extension === '.jsx'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const names = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
    else if (ts.isClassDeclaration(statement) && statement.name) names.push(statement.name.text);
    else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    )
      names.push(statement.name.text);
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const text = declaration.name.getText(sourceFile);
        if (/^[A-Za-z_$][\w$]*$/.test(text)) names.push(text);
      }
    }
  }
  return names;
}

export function exportedNames(source, fileName) {
  const extension = extname(fileName);
  const scriptKind =
    extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.js' || extension === '.mjs' || extension === '.cjs'
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const names = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.push(element.name.text);
      }
      continue;
    }
    if (!ts.canHaveModifiers(statement)) continue;
    const exported = (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
    else if (ts.isClassDeclaration(statement) && statement.name) names.push(statement.name.text);
    else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    )
      names.push(statement.name.text);
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const text = declaration.name.getText(sourceFile);
        if (/^[A-Za-z_$][\w$]*$/.test(text)) names.push(text);
      }
    }
  }
  return names;
}

export function collectSourceFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (['node_modules', 'dist', 'target', '.git'].includes(entry)) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
        files.push(full);
      }
    }
  };
  walk(directory);
  return files;
}

/**
 * Pure comparison used by the CLI and its tests.
 * @param {{baseSource:string,baseName:string,targetSource:string,targetName:string,destSources:Array<{source:string,name:string}>}} input
 */
export function verifyDeclarations(input) {
  const base = new Set(declarationNames(input.baseSource, input.baseName));
  const present = new Set(declarationNames(input.targetSource, input.targetName));
  for (const file of input.destSources) {
    for (const name of declarationNames(file.source, file.name)) present.add(name);
  }
  const missing = [...base].filter((name) => !present.has(name)).sort();
  const baseExports = new Set(exportedNames(input.baseSource, input.baseName));
  const targetExports = new Set(exportedNames(input.targetSource, input.targetName));
  const missingExports = [...baseExports].filter((name) => !targetExports.has(name)).sort();
  return { baseCount: base.size, presentCount: present.size, missing, missingExports };
}

function readBaseFile(root, ref, target) {
  return execFileSync('git', ['show', ref + ':' + target], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main(argv) {
  const json = argv.includes('--json');
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };
  const base = value('--base');
  const target = value('--target');
  const dest = value('--dest');
  if (!base || !target) {
    console.error(
      'Usage: node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> [--dest <dir>] [--json]',
    );
    return 2;
  }
  const root = process.cwd();
  let baseSource;
  try {
    baseSource = readBaseFile(root, base, target);
  } catch {
    console.error('refactor-verify: cannot read ' + target + ' at ' + base);
    return 2;
  }
  let targetSource = '';
  try {
    targetSource = readFileSync(resolve(root, target), 'utf8');
  } catch {
    targetSource = '';
  }
  const destSources = dest
    ? collectSourceFiles(resolve(root, dest)).map((path) => ({
        source: readFileSync(path, 'utf8'),
        name: path,
      }))
    : [];
  const result = verifyDeclarations({
    baseSource,
    baseName: target,
    targetSource,
    targetName: target,
    destSources,
  });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.missing.length === 0 && result.missingExports.length === 0) {
    console.log(
      'refactor-verify OK: ' +
        result.baseCount +
        ' declaration(s) preserved (' +
        result.presentCount +
        ' found across the target and destination).',
    );
  } else {
    if (result.missing.length > 0)
      console.error('Missing declaration(s): ' + result.missing.join(', '));
    if (result.missingExports.length > 0)
      console.error('Missing exported name(s) from target: ' + result.missingExports.join(', '));
  }
  return result.missing.length === 0 && result.missingExports.length === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('refactor-verify.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
