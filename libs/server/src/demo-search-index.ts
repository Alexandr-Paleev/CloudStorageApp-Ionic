/**
 * What a demo account's files come indexed with.
 *
 * `/api/ai/index` refuses demo accounts: a description is the one call this
 * deployment pays for, and anyone can open a demo. Without an index the
 * searchbar of a demo would find nothing, and a visitor would learn nothing
 * about search by meaning. So the seed carries its index: each file's
 * description and vector, made once by `libs/server/scripts/demo-search-index.ts` the way
 * `/api/ai/index` makes them, kept in `public/demo/` next to the files and
 * fetched with them.
 *
 * The vectors belong to one embedding model. A deployment that searches with
 * another one seeds no index rather than a wrong one: `match_files` would not
 * compare those rows anyway, and the dashboard offers the files as not indexed.
 */

export const DEMO_SEARCH_INDEX_ASSET = 'search-index.json';

export interface DemoIndexedFile {
  summary: string;
  tags: string[];
  /** The model that wrote the summary, as `/api/ai/index` records it. */
  summary_model: string;
  embedding: number[];
}

export interface DemoSearchIndex {
  /** The embedding model the vectors were made with. */
  model: string;
  /** By asset name under public/demo/. A file the model cannot read is absent. */
  files: Record<string, DemoIndexedFile>;
}
