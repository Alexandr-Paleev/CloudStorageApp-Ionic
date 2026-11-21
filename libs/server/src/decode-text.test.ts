import { describe, it, expect } from 'vitest';
import { decodeText, withoutNul } from './decode-text';

const TEXT = 'Договор: 950 €';

describe('decodeText', () => {
  it('reads UTF-8', () => {
    expect(decodeText(Buffer.from(TEXT, 'utf8'))).toBe(TEXT);
  });

  it('drops a UTF-8 byte-order mark', () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT)]))).toBe(
      TEXT
    );
  });

  /* What Notepad saves as "Unicode". Read as UTF-8, it was a NUL after every
     Latin letter, which Postgres will not keep. */
  it('reads UTF-16 little-endian by its mark', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TEXT, 'utf16le')]);
    expect(decodeText(bytes)).toBe(TEXT);
  });

  it('reads UTF-16 big-endian by its mark', () => {
    const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(TEXT, 'utf16le').swap16()]);
    expect(decodeText(bytes)).toBe(TEXT);
  });

  it('leaves out half a character at the end of big-endian text', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from('ab', 'utf16le').swap16(),
      Buffer.from([0x00]),
    ]);
    expect(decodeText(bytes)).toBe('ab');
  });

  it('never gives a NUL', () => {
    expect(decodeText(Buffer.from('a\u0000b\u0000', 'utf8'))).toBe('ab');
  });
});

describe('withoutNul', () => {
  it('drops every NUL and keeps the rest', () => {
    expect(withoutNul('\u0000a\u0000b\u0000')).toBe('ab');
    expect(withoutNul('plain')).toBe('plain');
  });
});
