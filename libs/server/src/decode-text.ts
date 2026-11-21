/**
 * A text file's bytes as the text a person wrote.
 *
 * UTF-8 unless a byte-order mark says otherwise. Windows' Notepad saves
 * "Unicode" as UTF-16 with a mark, and read as UTF-8 such a file is every
 * other character a NUL: a model shrugs at that, but Postgres refuses to keep
 * it ("null character not permitted"), and the file's pieces could never be
 * stored (ADR 0019). A NUL left in any text is dropped for the same reason:
 * nothing a person reads is one.
 */
export function decodeText(bytes: Buffer): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.subarray(2).toString('utf16le');
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Big-endian: swapped into the order Node decodes. An odd last byte is
    // half a character, and is left out.
    const body = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)));
    text = body.swap16().toString('utf16le');
  } else {
    text = bytes.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  return withoutNul(text);
}

/** The text without the one character Postgres will not store. */
export function withoutNul(text: string): string {
  return text.includes('\u0000') ? text.split('\u0000').join('') : text;
}
