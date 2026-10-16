/**
 * Process-backed `Io` for the automation commands.
 */
import type { Io } from './commands';

export function processIo(): Io {
  return {
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
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
