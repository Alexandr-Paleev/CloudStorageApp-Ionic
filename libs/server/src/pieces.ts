import { CHUNK_OVERLAP, CHUNK_SIZE, MAX_PIECES_PER_FILE } from '../../core/src/ai';
import { chunkText } from '../../core/src/chunks';
import { withoutNul } from './decode-text';

/**
 * The pieces a question is answered from (ADR 0019), cut from the file's text
 * or, for a file with none, from its description, so that every indexed file
 * has at least one. A file longer than MAX_PIECES_PER_FILE pieces is kept as
 * far as that goes.
 *
 * Shared by `/api/ai/index` and by the script that indexes the demo
 * (libs/server/scripts/demo-search-index.ts), so a demo is cut as any file is.
 */
export function piecesOf(text: string | null, summary: string): string[] {
  /* No NUL, which Postgres will not store, whatever the text came from. And
     not all of an 8 MB file, to keep the first 200 pieces of it: they hold
     about 200 × 400 characters of text, and the cut reads twice that. Only a
     file with more space between its paragraphs than words in them would
     keep a different, still valid, set of pieces. */
  const clean = withoutNul(text ?? '');
  const source = clean.trim() ? clean : summary;
  const reach = MAX_PIECES_PER_FILE * CHUNK_SIZE * 2;
  return chunkText(source.slice(0, reach), CHUNK_SIZE, CHUNK_OVERLAP).slice(0, MAX_PIECES_PER_FILE);
}
