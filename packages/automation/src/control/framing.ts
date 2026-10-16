/**
 * Bounded newline-delimited framing for byte streams.
 *
 * One UTF-8 JSON document per line (the MCP stdio rule, reused by the control
 * channel). The reader never buffers more than `maxLineBytes` of an unfinished
 * line: an oversize line is discarded as it streams in (not accumulated and
 * rejected afterwards, which is how a hostile client costs memory), the
 * consumer is told once, and framing resumes at the next newline.
 *
 * Bytes are decoded only at line boundaries, so a multibyte character split
 * across reads is reassembled correctly.
 */

export interface FramerHandlers {
  onLine(line: string): void;
  /** A line exceeded the limit and is being discarded until the next newline. */
  onOverflow(limit: number): void;
  /** A completed line was not valid UTF-8. */
  onInvalidUtf8(): void;
}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export class LineFramer {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private discarding = false;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(
    private maxLineBytes: number,
    private readonly handlers: FramerHandlers,
  ) {}

  /** Change the limit, for example after a connection authenticates. */
  setMaxLineBytes(limit: number): void {
    this.maxLineBytes = limit;
  }

  get pendingBytes(): number {
    return this.length;
  }

  push(data: Uint8Array): void {
    let start = 0;
    while (start < data.length) {
      const newline = data.indexOf(NEWLINE, start);
      const end = newline === -1 ? data.length : newline;
      const piece = data.subarray(start, end);

      if (this.discarding) {
        // Drop bytes until the line ends; keep nothing.
      } else if (this.length + piece.length > this.maxLineBytes) {
        this.discarding = true;
        this.chunks = [];
        this.length = 0;
        this.handlers.onOverflow(this.maxLineBytes);
      } else if (piece.length > 0) {
        this.chunks.push(piece.slice());
        this.length += piece.length;
      }

      if (newline === -1) return;
      if (this.discarding) {
        this.discarding = false;
      } else {
        this.flushLine();
      }
      start = newline + 1;
    }
  }

  /** Signal end of stream; an unterminated final line is delivered. */
  end(): void {
    if (!this.discarding && this.length > 0) this.flushLine();
    this.chunks = [];
    this.length = 0;
    this.discarding = false;
  }

  private flushLine(): void {
    const total = this.length;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.length = 0;
    let end = total;
    if (end > 0 && bytes[end - 1] === CARRIAGE_RETURN) end -= 1;
    if (end === 0) return;
    let line: string;
    try {
      line = this.decoder.decode(bytes.subarray(0, end));
    } catch {
      this.handlers.onInvalidUtf8();
      return;
    }
    if (line.trim().length === 0) return;
    this.handlers.onLine(line);
  }
}
