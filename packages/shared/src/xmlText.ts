/**
 * XML 1.0 text sanitization shared by every export surface that writes markup.
 *
 * `escapeXmlText` is the only correct way to put document text into SVG, XMP,
 * or any other XML serialization. Escaping the five metacharacters is not
 * enough: XML 1.0 §2.2 also forbids C0 controls (other than tab/LF/CR), the
 * noncharacters U+FFFE/U+FFFF, and unpaired UTF-16 surrogates. Those cannot be
 * represented at all — not even as character references — so a single pasted
 * control character used to make the whole exported file unparseable while the
 * export still looked successful.
 *
 * Evidence: storytold/lightcraft#2131 ("XMP writer emits characters XML 1.0
 * forbids … so other tools reject the whole sidecar").
 */

/** U+FFFD REPLACEMENT CHARACTER: the visible, parseable stand-in. */
const REPLACEMENT = '\uFFFD';

export function isXmlChar(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd) return true;
  if (codePoint < 0x20) return false;
  if (codePoint <= 0xd7ff) return true;
  if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true;
  return codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

function isLoneSurrogate(character: string): boolean {
  return (
    character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff
  );
}

/**
 * Make text representable in an XML 1.0 document.
 *
 * Characters that never had a visual form — C0 controls (other than tab/LF/CR)
 * and the noncharacters U+FFFE/U+FFFF — are removed, so the exported text
 * matches what the canvas showed. An unpaired UTF-16 surrogate stands for a
 * character that could not be decoded at all, so it becomes U+FFFD instead of
 * vanishing. Legal whitespace, CJK, and supplementary-plane characters
 * (including emoji) are preserved verbatim.
 */
export function sanitizeXmlText(value: string): string {
  let needsWork = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (!isXmlChar(codePoint) || isLoneSurrogate(character)) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) return value;

  let out = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (isXmlChar(codePoint)) {
      out += character;
    } else if (isLoneSurrogate(character)) {
      out += REPLACEMENT;
    }
  }
  return out;
}

/**
 * Sanitize then escape text for an XML element body or attribute value.
 *
 * `&`, `<`, `>` and `"` are escaped; `'` is not, because every call site emits
 * double-quoted attributes and escaping it would change plain text content for
 * no benefit.
 */
export function escapeXmlText(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
