/**
 * Encrypted-document detection for PDF import.
 *
 * Varve does not implement the PDF Standard Security Handler, so an encrypted
 * file's strings and streams are ciphertext to this importer. Reading them as
 * content produces an empty or nonsensical document that reports success —
 * the failure mode where a user opens a protected PDF and gets a blank page
 * with no explanation.
 *
 * Detection is deliberately conservative: `/Encrypt` is only honoured in the
 * trailer region or in an object that is itself a cross-reference stream
 * dictionary, so the word appearing inside page content cannot refuse a
 * readable document.
 */
import { dictName, type PdfIndex } from './objects';

export interface EncryptionInfo {
  /** `/Filter` from the encryption dictionary, e.g. `Standard`. */
  readonly filter: string | null;
  /** True when the encryption dictionary declares AES or RC4 revisions. */
  readonly declaresStandardSecurityHandler: boolean;
}

const ENCRYPT_KEY = /\/Encrypt\b/;

/** Locate `/Encrypt` in the trailer, or in a cross-reference stream dictionary. */
export function detectEncryption(index: PdfIndex): EncryptionInfo | null {
  const trailer = trailerRegion(index.text);
  const at = ENCRYPT_KEY.exec(trailer) ?? ENCRYPT_KEY.exec(xrefStreamHeaders(index));
  if (!at) return null;
  const after = trailer.slice(at.index, at.index + 200);
  return describeEncryption(index, after);
}

/** The file tail from its last `trailer` keyword, or the last 8 KB. */
function trailerRegion(text: string): string {
  const trailerAt = text.lastIndexOf('trailer');
  if (trailerAt >= 0) return text.slice(trailerAt);
  return text.slice(Math.max(0, text.length - 8192));
}

/** Concatenated headers of `/Type /XRef` objects (files without a trailer). */
function xrefStreamHeaders(index: PdfIndex): string {
  let out = '';
  for (const object of index.objects.values()) {
    if (/\/Type\s*\/XRef\b/.test(object.header)) out += `${object.header}\n`;
  }
  return out;
}

function describeEncryption(index: PdfIndex, region: string): EncryptionInfo {
  const reference = /\/Encrypt\s+(\d+)\s+\d+\s+R/.exec(region);
  const referenced = reference ? index.objects.get(Number(reference[1])) : null;
  const header = referenced?.header ?? inlineDictionary(region);
  if (header === null) return { filter: null, declaresStandardSecurityHandler: false };
  const filter = dictName(header, 'Filter');
  return {
    filter,
    declaresStandardSecurityHandler: filter === null || filter === 'Standard',
  };
}

/** `/Encrypt << ... >>` written directly in the trailer. */
function inlineDictionary(region: string): string | null {
  const at = /\/Encrypt\s*<</.exec(region);
  if (!at) return null;
  const start = at.index + at[0].length - 2;
  let depth = 0;
  for (let i = start; i < region.length; i += 1) {
    if (region.startsWith('<<', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (region.startsWith('>>', i)) {
      depth -= 1;
      if (depth === 0) return region.slice(start + 2, i);
      i += 1;
    }
  }
  return null;
}
