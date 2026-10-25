/** Output-side ByteLevel BPE decoder for the pinned TrOCR/Roberta vocabulary.
 * OCR generates token ids; it never encodes a user prompt or needs BPE merges. */
export interface TrOcrTokenizerJson {
  model: { type: string; vocab: Record<string, number> };
  decoder: { type: string };
  added_tokens: Array<{ id: number; special: boolean }>;
}

function byteAlphabet(): Map<string, number> {
  const visible = Array.from({ length: 256 }, (_, byte) => byte).filter(
    (byte) => (byte >= 33 && byte <= 126) || (byte >= 161 && byte <= 172) || byte >= 174,
  );
  const alphabet = new Map(visible.map((byte) => [String.fromCodePoint(byte), byte]));
  let next = 256;
  for (let byte = 0; byte < 256; byte++) {
    if (!visible.includes(byte)) alphabet.set(String.fromCodePoint(next++), byte);
  }
  return alphabet;
}

const BYTE_ALPHABET = byteAlphabet();

export class TrOcrTokenizer {
  private readonly vocabulary = new Map<number, string>();
  private readonly special = new Set<number>();

  constructor(json: TrOcrTokenizerJson) {
    if (json?.model?.type !== 'BPE' || json?.decoder?.type !== 'ByteLevel') {
      throw new Error('TrOCR requires its ByteLevel BPE tokenizer');
    }
    for (const [piece, id] of Object.entries(json.model.vocab)) {
      if (!Number.isInteger(id) || id < 0 || id >= 50_265 || this.vocabulary.has(id)) {
        throw new Error('Invalid TrOCR vocabulary');
      }
      this.vocabulary.set(id, piece);
    }
    for (const token of json.added_tokens) if (token.special) this.special.add(token.id);
    if (this.vocabulary.get(2) !== '</s>' || this.vocabulary.get(1) !== '<pad>') {
      throw new Error('TrOCR tokenizer special tokens do not match the decoder');
    }
  }

  decode(
    ids: readonly number[],
    confidences: readonly number[],
  ): {
    text: string;
    confidence: number;
    charConfidences: number[];
  } {
    if (ids.length !== confidences.length) throw new Error('TrOCR token/confidence mismatch');
    const bytes: number[] = [];
    const byteConfidences: number[] = [];
    ids.forEach((id, index) => {
      const confidence = confidences[index]!;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('Invalid TrOCR token confidence');
      }
      if (this.special.has(id)) return;
      const piece = this.vocabulary.get(id);
      if (piece === undefined) throw new Error(`TrOCR tokenizer has no token ${id}`);
      for (const character of piece) {
        const byte = BYTE_ALPHABET.get(character);
        if (byte === undefined) throw new Error('Invalid TrOCR byte token');
        bytes.push(byte);
        byteConfidences.push(confidence);
      }
    });
    // Streaming decoding keeps a multibyte character split across BPE tokens
    // intact. Its confidence is the minimum of the contributing token scores.
    const decoder = new TextDecoder('utf-8');
    const characters: string[] = [];
    const scores: number[] = [];
    let score = 1;
    for (let index = 0; index < bytes.length; index++) {
      score = Math.min(score, byteConfidences[index]!);
      const decoded = decoder.decode(Uint8Array.of(bytes[index]!), { stream: true });
      for (const character of decoded) {
        characters.push(character);
        scores.push(score);
      }
      if (decoded) score = 1;
    }
    for (const character of decoder.decode()) {
      characters.push(character);
      scores.push(score);
    }
    let start = 0;
    let end = characters.length;
    while (start < end && /^\s$/u.test(characters[start]!)) start++;
    while (end > start && /^\s$/u.test(characters[end - 1]!)) end--;
    const charConfidences = scores.slice(start, end);
    return {
      text: characters.slice(start, end).join(''),
      confidence: charConfidences.length
        ? charConfidences.reduce((sum, value) => sum + value, 0) / charConfidences.length
        : 0,
      charConfidences,
    };
  }
}

/** Acquisition is explicit through Offline Models. Read only the verified
 * installed asset; an offline OCR operation never silently fetches upstream. */
export async function loadTrOcrTokenizer(
  path: string,
  signal?: AbortSignal,
): Promise<TrOcrTokenizer> {
  signal?.throwIfAborted();
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('The installed TrOCR tokenizer could not be read');
  const json = (await response.json()) as TrOcrTokenizerJson;
  signal?.throwIfAborted();
  return new TrOcrTokenizer(json);
}
