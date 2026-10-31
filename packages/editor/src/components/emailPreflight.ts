import type { CombinedPreflightIssue, CombinedPreflightResult, Document } from '@varve/scene';
import { getEmailCompilation } from './Inspector/panels/emailCompilation';

/**
 * Status-bar counts for Email workspace. Print preflight (bleed, fonts,
 * overset) is the wrong checklist here; the compiler diagnostics are what
 * the designer is actually looking at.
 */
export function emailPreflightResult(document: Document): CombinedPreflightResult {
  const compilation = getEmailCompilation(document);
  const warnings = compilation?.output.warnings ?? [];
  const issues: CombinedPreflightIssue[] = [
    ...(compilation?.ir.diagnostics ?? []).map((diagnostic) => ({
      source: 'email' as const,
      severity: diagnostic.severity,
      category: diagnostic.category,
      message: diagnostic.message,
      nodeId: diagnostic.sourceNodeId,
    })),
    ...warnings.map((warning) => ({
      source: 'email' as const,
      severity: warning.severity,
      category: warning.category,
      message: warning.message,
      nodeId: warning.sourceNodeId,
    })),
  ];
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    ready: errorCount === 0,
    checks: [],
  };
}
