/**
 * Writes public/demo/search-index.json: the description and the vector of each
 * demo file, and its pieces with theirs, made by the same functions
 * `/api/ai/index` calls, so that a demo account can search by meaning, and
 * ask its files a question, without one paid call
 * (libs/server/src/demo-search-index.ts).
 *
 * Run it when the seed changes, or the model the free path describes or
 * embeds with, with the Workers AI keys in .env:
 *
 *   npx tsx --env-file=.env libs/server/scripts/demo-search-index.ts
 *
 * The models are the deployment's: whichever `activeBackend()` picks from the
 * keys present, and the file records which. A test holds that to the model
 * the free path embeds with.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEXT_SAMPLE_BYTES, embeddingInput, planFor } from '../../core/src/ai';
import { pieceInput } from '../../core/src/chunks';
import { piecesOf } from '../src/pieces';
import type { DescribeSource } from '../src/describe';
import { activeBackend } from '../src/ai-provider';
import { decodeText } from '../src/decode-text';
import { pdfText } from '../src/to-markdown';
import { DEMO_SEED } from '../src/demo';
import { DEMO_SEARCH_INDEX_ASSET, type DemoSearchIndex } from '../src/demo-search-index';

const DEMO_DIR = join(import.meta.dirname, '..', '..', '..', 'public', 'demo');

/* Six decimals keep the file small and move a cosine similarity by less than
   one in a million. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

async function main(): Promise<void> {
  const backend = activeBackend();
  const index: DemoSearchIndex = { model: backend.embeddingModel, files: {} };

  for (const item of DEMO_SEED) {
    const bytes = readFileSync(join(DEMO_DIR, item.asset));
    const file = {
      name: item.name,
      type: item.type,
      size: bytes.length,
      storage_type: 'supabase_storage',
    };
    const plan = planFor(file);

    if (plan.kind === 'skip' || !backend.supports(plan.kind)) {
      console.log(`${item.asset}: not indexed, as /api/ai/index would not index it`);
      continue;
    }

    /* As /api/ai/index reads a file: a PDF goes as it is to a model that takes
       one, and as its text, read by toMarkdown, to one that does not. */
    const sample = (text: string) =>
      Buffer.from(text, 'utf8').subarray(0, TEXT_SAMPLE_BYTES).toString('utf8');
    // The text the pieces are cut from: none for a picture, cut from its description.
    const text =
      plan.kind === 'text'
        ? decodeText(bytes)
        : plan.kind === 'pdf'
          ? await pdfText(bytes, item.name)
          : null;
    const source: DescribeSource =
      plan.kind === 'text'
        ? { kind: 'text', text: sample(text ?? '') }
        : plan.kind === 'pdf'
          ? backend.readsPdf
            ? { kind: 'pdf', data: bytes.toString('base64') }
            : { kind: 'text', text: sample(text ?? '') }
          : {
              kind: 'image',
              url: `data:${item.type};base64,${bytes.toString('base64')}`,
              mediaType: item.type,
            };

    const description = await backend.describe(item.name, source);
    const vector = await backend.embed(
      embeddingInput(file, description.summary, description.tags),
      'document'
    );

    const pieces = piecesOf(text, description.summary);
    const pieceVectors = await backend.embedMany(
      pieces.map((piece) => pieceInput(item.name, piece)),
      'document'
    );

    index.files[item.asset] = {
      summary: description.summary,
      tags: description.tags,
      summary_model: description.model,
      embedding: vector.map(round),
      pieces: pieces.map((content, i) => ({
        content,
        embedding: (pieceVectors[i] as number[]).map(round),
      })),
    };
    console.log(
      `${item.asset}: ${description.summary} [${description.tags.join(', ')}], ${pieces.length} pieces`
    );
  }

  writeFileSync(join(DEMO_DIR, DEMO_SEARCH_INDEX_ASSET), `${JSON.stringify(index)}\n`);
  console.log(
    `${Object.keys(index.files).length} files, ${index.model}, in public/demo/${DEMO_SEARCH_INDEX_ASSET}`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
