/**
 * Process-backed `Io` for the automation commands.
 */
import type { Io } from './commands';
import { printable } from './printable';

export function processIo(): Io {
  return {
    // Everything the person's terminal receives passes through `printable`:
    // document-derived text reaches both streams, and JSON output is unchanged
    // in meaning because the escape it writes is the JSON escape.
    out: (text) => {
      process.stdout.write(printable(text));
    },
    err: (text) => {
      process.stderr.write(printable(text));
    },
    env: process.env,
    async readStdin(maxBytes) {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        total += buffer.byteLength;
        if (total > maxBytes) {
          throw new Error(`standard input exceeds ${maxBytes} bytes`);
        }
        chunks.push(buffer);
      }
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}
