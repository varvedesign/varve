/**
 * Make text safe to print on a terminal.
 *
 * Document content (layer names, text, the document's own name) is chosen by
 * whoever authored the file, and the CLI prints it to a person's terminal. A raw
 * escape sequence in it can clear the screen, retitle the window or overwrite
 * lines that said something else; a bidirectional override can make one thing
 * read as another. So control characters are written out as `\uXXXX` instead.
 *
 * That spelling is deliberate: it is a valid JSON escape, so machine output (where
 * `JSON.stringify` already escapes C0 controls but not bidi controls) decodes to
 * the same value, and in plain text it is simply visible. Newline and tab are
 * kept, because layout needs them and neither moves the cursor anywhere unexpected.
 */

// C0 except \t and \n, DEL and C1 (8-bit escapes some terminals honour), and the
// bidirectional embedding/override/isolate controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function printable(text: string): string {
  return text.replace(UNSAFE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
