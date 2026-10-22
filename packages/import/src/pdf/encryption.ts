/**
 * Encrypted-document detection for PDF import.
 *
 * Varve does not implement the PDF Standard Security Handler, so an encrypted
 * file's strings and streams are ciphertext to this importer. Reading them as
 * content produces an empty or nonsensical document that reports success —
 * the failure mode where a user opens a protected PDF and gets a blank page
 * with no explanation.
 *
 * Detection must not refuse a readable document. `/Encrypt` is therefore only
 * honoured where the format puts it — as a dictionary entry in the trailer or
 * in a cross-reference stream's own dictionary — and only when it has a value
 * (`n g R` or an inline dictionary). The word appearing inside page content, a
 * string, a comment or a `/Encrypt null` entry is not encryption.
 */
import { dictName, type PdfIndex } from './objects';

export interface EncryptionInfo {
  /** `/Filter` from the encryption dictionary, e.g. `Standard`. */
  readonly filter: string | null;
}

/** A dictionary entry whose value is a reference or an inline dictionary. */
const ENCRYPT_ENTRY = /\/Encrypt\s+(?:(\d+\s+\d+\s+R)|<<)/;

/** Locate `/Encrypt` in the trailer, or in a cross-reference stream dictionary. */
export function detectEncryption(index: PdfIndex): EncryptionInfo | null {
  const trailer = trailerRegion(index.text);
  if (trailer !== null) {
    const found = ENCRYPT_ENTRY.exec(trailer.text);
    if (found) return describeEncryption(index, trailer.text, found);
  }
  for (const object of index.objects.values()) {
    if (!/\/Type\s*\/XRef\b/.test(object.header)) continue;
    const found = ENCRYPT_ENTRY.exec(object.header);
    if (found) return describeEncryption(index, object.header, found);
  }
  return null;
}

interface Region {
  readonly text: string;
}

/** The file tail from its last `trailer` keyword, or null when there is none. */
function trailerRegion(text: string): Region | null {
  const trailerAt = text.lastIndexOf('trailer');
  return trailerAt >= 0 ? { text: text.slice(trailerAt) } : null;
}

function describeEncryption(
  index: PdfIndex,
  source: string,
  match: RegExpExecArray,
): EncryptionInfo {
  const reference = match[1];
  if (reference) {
    const object = index.objects.get(Number(reference.split(/\s+/)[0]));
    return { filter: object ? dictName(object.header, 'Filter') : null };
  }
  // Inline dictionary: read `/Filter` from the dictionary body itself.
  const open = match.index + match[0].length - 2;
  const body = dictionaryBody(source, open);
  return { filter: body === null ? null : dictName(body, 'Filter') };
}

/** Body of the `<< … >>` dictionary that starts at `open`, without brackets. */
function dictionaryBody(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text.startsWith('<<', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text.startsWith('>>', i)) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 2, i);
      i += 1;
    }
  }
  return null;
}
