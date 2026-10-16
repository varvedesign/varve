/**
 * Adapter from the automation schema DSL to the Standard Schema interface the
 * MCP SDK accepts, so one definition produces the advertised JSON Schema, the
 * argument validation, and the executor's own checks. No second schema
 * language, no Zod mirror to drift.
 */
import { type Schema, toJsonSchema, validateUnknown } from '@varve/automation';

type Issue = { message: string; path?: ReadonlyArray<PropertyKey> };

function pathSegments(pointer: string): PropertyKey[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function standardSchema(schema: Schema) {
  const json = toJsonSchema(schema);
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'varve',
      validate: (value: unknown) => {
        const result = validateUnknown(schema, value);
        if (result.ok) return { value: result.value };
        const issues: Issue[] = result.issues.map((issue) => ({
          message: issue.hint ? `${issue.message} (${issue.hint})` : issue.message,
          path: pathSegments(issue.path),
        }));
        return { issues };
      },
      jsonSchema: {
        input: () => json,
        output: () => json,
      },
    },
  };
}
