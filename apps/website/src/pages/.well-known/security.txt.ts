import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRoute } from 'astro';

const SECURITY_TXT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../public/.well-known/security.txt'),
  'utf8',
);

export const GET: APIRoute = () =>
  new Response(SECURITY_TXT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
