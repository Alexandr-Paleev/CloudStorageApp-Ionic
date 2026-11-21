import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHUNK_OVERLAP, CHUNK_SIZE } from './ai';
import { chunkText, pieceInput } from './chunks';

/* The cut's specification is evals/src/search_evals/chunks.py, where the size
   was measured. Its expected pieces are written once, in ai.eval-contract.json,
   and evals/tests/test_contract.py runs the same cases against the Python. */
const contract = JSON.parse(
  readFileSync(new URL('./ai.eval-contract.json', import.meta.url), 'utf8')
) as {
  chunks: { name: string; text: string; size: number; overlap: number; pieces: string[] }[];
  pieceInput: { name: string; text: string; expected: string }[];
};

describe('chunkText, held to the eval', () => {
  it.each(contract.chunks)('$name', ({ text, size, overlap, pieces }) => {
    expect(chunkText(text, size, overlap)).toEqual(pieces);
  });

  it.each(contract.pieceInput)('embeds a piece of $name as the eval does', (c) => {
    expect(pieceInput(c.name, c.text)).toBe(c.expected);
  });
});

describe('chunkText', () => {
  it('keeps every piece within the size, counted in characters', () => {
    const text = '😀'.repeat(30) + ' word. '.repeat(200) + '\n\n' + 'Ж'.repeat(900);
    for (const piece of chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP)) {
      expect([...piece].length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('never cuts a character in half', () => {
    for (const piece of chunkText('😀'.repeat(9), 4, 0)) {
      expect(piece).toMatch(/^(?:😀)+$/u);
    }
  });

  it('drops nothing but space', () => {
    const text = 'Первый абзац. Второе предложение!\n\nLong ' + 'x'.repeat(30) + ' tail.';
    const kept = chunkText(text, 12, 0).join('').replace(/\s/g, '');
    expect(kept).toBe(text.replace(/\s/g, ''));
  });

  it.each([
    [0, 0],
    [10, 10],
    [10, -1],
    [1.5, 0],
  ])('refuses a size of %s with an overlap of %s', (size, overlap) => {
    expect(() => chunkText('text', size, overlap)).toThrow(RangeError);
  });
});
