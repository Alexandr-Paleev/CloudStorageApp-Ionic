/**
 * How a file's text is cut into the pieces a question is answered from
 * (docs/decisions/0019).
 *
 * The specification is `evals/src/search_evals/chunks.py`, where the size was
 * chosen by measurement; this is the same cut in TypeScript. The cases in
 * `ai.eval-contract.json` are run against both, so the two cannot drift.
 *
 * 1. A paragraph (text between blank lines) is the unit. A piece is as many
 *    whole paragraphs as fit.
 * 2. A paragraph longer than `size` is split into sentences, a sentence into
 *    runs of words, and a word longer than `size` is cut at `size`. Nothing is
 *    dropped.
 * 3. Each piece after the first starts with the last units of the one before,
 *    up to `overlap` characters of them, repeated whole or not at all.
 * 4. A piece is a slice of the original text, trimmed, so whatever it says can
 *    be found in the file as it is written there.
 *
 * Two things the Python side gets for free are done by hand here:
 * - A character is a code point, as Python and Postgres' `char_length` count
 *   it. A JavaScript string counts an emoji as two, so lengths are measured
 *   through `codePoints` rather than `.length`.
 * - Whitespace is the set written out in `SPACE`, the same as `chunks.py`:
 *   the two languages' own ideas of space differ on a few characters.
 */

/** Every character both languages take for space, and no other. */
const SPACE = '\t\n\v\f\r              ' + '    　';
const SPACE_CLASS = `[${SPACE.replace(/[\\\]^-]/g, '\\$&')}]`;

/* A blank line, possibly with spaces or tabs on it, ends a paragraph. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;
/* A sentence ends at . ! ? or … followed by space. */
const SENTENCE_END = new RegExp(`(?<=[.!?…])${SPACE_CLASS}+`, 'g');
const WORD = new RegExp(`[^${SPACE_CLASS.slice(1, -1)}]+`, 'g');

type Span = readonly [start: number, end: number];

/** Code points before each UTF-16 index, so a span's length in characters is
 *  one subtraction. Indexes inside a surrogate pair are never a span's end. */
function codePoints(text: string): Int32Array {
  const before = new Int32Array(text.length + 1);
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    before[i] = count;
    const unit = text.charCodeAt(i);
    // A high surrogate starts a pair: the pair is one character.
    if (unit < 0xd800 || unit > 0xdbff) count++;
  }
  before[text.length] = count;
  return before;
}

function isSpace(char: string): boolean {
  return SPACE.includes(char);
}

function trimmed(text: string, start: number, end: number): Span | null {
  while (start < end && isSpace(text[start] as string)) start++;
  while (end > start && isSpace(text[end - 1] as string)) end--;
  return start < end ? [start, end] : null;
}

/** The spans between matches of `pattern` inside text[start:end], trimmed. */
function between(text: string, start: number, end: number, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  let cursor = start;
  const slice = text.slice(start, end);
  for (const match of slice.matchAll(pattern)) {
    const at = start + (match.index ?? 0);
    const span = trimmed(text, cursor, at);
    if (span) spans.push(span);
    cursor = at + match[0].length;
  }
  const last = trimmed(text, cursor, end);
  if (last) spans.push(last);
  return spans;
}

/** The UTF-16 index `count` characters after `from`. */
function advance(text: string, from: number, count: number): number {
  let index = from;
  for (let n = 0; n < count && index < text.length; n++) {
    const unit = text.charCodeAt(index);
    index += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
  }
  return index;
}

/** Runs of whole words, each at most `size` characters; a longer word is cut. */
function words(text: string, start: number, end: number, size: number, cp: Int32Array): Span[] {
  const runs: Span[] = [];
  const length = (a: number, b: number) => (cp[b] as number) - (cp[a] as number);
  let run: [number, number] | null = null;
  for (const match of text.slice(start, end).matchAll(WORD)) {
    let wordStart = start + (match.index ?? 0);
    const wordEnd = wordStart + match[0].length;
    while (length(wordStart, wordEnd) > size) {
      if (run) {
        runs.push(run);
        run = null;
      }
      const cut = advance(text, wordStart, size);
      runs.push([wordStart, cut]);
      wordStart = cut;
    }
    if (run && length(run[0], wordEnd) <= size) {
      run[1] = wordEnd;
    } else {
      if (run) runs.push(run);
      run = [wordStart, wordEnd];
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** The spans a piece is built from: paragraphs, or what a long one splits into. */
function units(text: string, size: number, cp: Int32Array): Span[] {
  const length = (a: number, b: number) => (cp[b] as number) - (cp[a] as number);
  const out: Span[] = [];
  for (const [pStart, pEnd] of between(text, 0, text.length, PARAGRAPH_BREAK)) {
    if (length(pStart, pEnd) <= size) {
      out.push([pStart, pEnd]);
      continue;
    }
    for (const [sStart, sEnd] of between(text, pStart, pEnd, SENTENCE_END)) {
      if (length(sStart, sEnd) <= size) out.push([sStart, sEnd]);
      else out.push(...words(text, sStart, sEnd, size, cp));
    }
  }
  return out;
}

/** The pieces of `text`, each at most `size` characters, in order. */
export function chunkText(raw: string, size: number, overlap: number): string[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be at least 1');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new RangeError('overlap must be at least 0 and smaller than size');
  }
  const text = raw.replace(/\r\n/g, '\n');
  const cp = codePoints(text);
  const length = (a: number, b: number) => (cp[b] as number) - (cp[a] as number);
  const spans = units(text, size, cp);
  const startOf = (i: number) => (spans[i] as Span)[0];
  const endOf = (i: number) => (spans[i] as Span)[1];

  const pieces: string[] = [];
  let first = 0;
  while (first < spans.length) {
    let last = first;
    while (last + 1 < spans.length && length(startOf(first), endOf(last + 1)) <= size) last++;
    pieces.push(text.slice(startOf(first), endOf(last)));
    if (last + 1 >= spans.length) break;
    // The next piece goes back over the last units of this one, as many as fit
    // in `overlap` and leave room for at least one new unit; it always moves
    // forward by at least one unit.
    let following = last + 1;
    while (
      following - 1 > first &&
      length(startOf(following - 1), endOf(last)) <= overlap &&
      length(startOf(following - 1), endOf(last + 1)) <= size
    ) {
      following--;
    }
    first = following;
  }
  return pieces;
}

/**
 * The text a piece is embedded as: the file's name, then the piece. The name
 * says what a piece often does not: "Importe total a pagar: 86,40 euros" does
 * not say it is electricity, and `factura-luz-marzo-2026.pdf` does.
 */
export function pieceInput(name: string, text: string): string {
  return `${name}\n${text}`;
}
