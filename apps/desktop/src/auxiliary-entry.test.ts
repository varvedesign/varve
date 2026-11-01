import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('auxiliary webview policy bootstrap', () => {
  it('starts organisation policy load before React mounts', () => {
    const source = readFileSync(resolve(here, 'auxiliary.tsx'), 'utf8');
    expect(source).toContain('beginOrganizationPolicyLoad');
    expect(source).toContain('void beginOrganizationPolicyLoad()');
    expect(source.indexOf('void beginOrganizationPolicyLoad()')).toBeLessThan(
      source.indexOf('createRoot(root)'),
    );
  });
});
