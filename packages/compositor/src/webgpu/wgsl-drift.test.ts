// @vitest-environment node

/**
 * Drift guard: the naga-validated WGSL mirror in strata-bridge must stay
 * byte-identical (modulo whitespace) to the TypeScript source of truth.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLIT_FRAGMENT_WGSL,
  BLIT_VERTEX_WGSL,
  CIRCLE_FRAGMENT_WGSL,
  CIRCLE_VERTEX_WGSL,
  SOLID_FRAGMENT_WGSL,
  SOLID_VERTEX_WGSL,
} from './shaders';

const here = dirname(fileURLToPath(import.meta.url));
const rustDir = join(here, '../../../../crates/varve-bridge/tests/wgsl_validation');

function readRustMirrors(): string {
  return readdirSync(rustDir)
    .filter((file) => file.endsWith('.rs'))
    .sort()
    .map((file) => readFileSync(join(rustDir, file), 'utf8'))
    .join('\n');
}

function extractRustWgsl(src: string, constName: string): string {
  const marker = `const ${constName}: &str = r#"`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${constName} in the wgsl_validation modules`);
  const bodyStart = start + marker.length;
  const end = src.indexOf('"#;', bodyStart);
  if (end < 0) throw new Error(`unclosed ${constName} in the wgsl_validation modules`);
  return src.slice(bodyStart, end);
}

function norm(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

describe('TS / Rust WGSL drift guard', () => {
  const rust = readRustMirrors();

  it('SOLID_VERTEX_WGSL matches naga mirror', () => {
    expect(norm(extractRustWgsl(rust, 'SOLID_VERTEX_WGSL'))).toBe(norm(SOLID_VERTEX_WGSL));
  });

  it('SOLID_FRAGMENT_WGSL matches naga mirror', () => {
    expect(norm(extractRustWgsl(rust, 'SOLID_FRAGMENT_WGSL'))).toBe(norm(SOLID_FRAGMENT_WGSL));
  });

  it('CIRCLE_VERTEX_WGSL matches naga mirror', () => {
    expect(norm(extractRustWgsl(rust, 'CIRCLE_VERTEX_WGSL'))).toBe(norm(CIRCLE_VERTEX_WGSL));
  });

  it('CIRCLE_FRAGMENT_WGSL matches naga mirror', () => {
    expect(norm(extractRustWgsl(rust, 'CIRCLE_FRAGMENT_WGSL'))).toBe(norm(CIRCLE_FRAGMENT_WGSL));
  });

  it('BLIT shaders match naga mirrors', () => {
    expect(norm(extractRustWgsl(rust, 'BLIT_VERTEX_WGSL'))).toBe(norm(BLIT_VERTEX_WGSL));
    expect(norm(extractRustWgsl(rust, 'BLIT_FRAGMENT_WGSL'))).toBe(norm(BLIT_FRAGMENT_WGSL));
  });
});
