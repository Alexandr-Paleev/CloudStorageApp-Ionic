import { supabase } from '../supabase/supabase.config';
import { apiUrl } from '../utils/api.utils';
import { httpErrorFrom } from '../utils/http.utils';
import { SEARCH_MIN_SIMILARITY, SEARCH_RESULTS, toVectorLiteral } from '../../lib/ai';
import type { FileMetadata } from '../schemas/file.schema';
import * as Sentry from '../observability/sentry';

/**
 * The browser's half of semantic search.
 *
 * Only the two steps that need a secret go through `/api/ai/*` — describing a
 * file and turning a query into a vector. The search itself is a query this
 * session makes against its own rows, exactly as the dashboard's ordinary
 * listing does, so what a caller can see is decided by RLS in the database
 * rather than by a server route remembering to forward a token.
 */

export interface SmartResult extends FileMetadata {
  /** The sentence a model wrote about the file, shown under the result. */
  summary: string;
  tags: string[];
  /** 1 is identical, 0 is unrelated. Kept for the eval more than for the UI. */
  similarity: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
  };
}

const aiService = {
  /**
   * Describes one file and stores its vector.
   *
   * Answers rather than throws when a file cannot be described — a ZIP or a
   * file in someone's own Drive is a normal outcome, not a failure.
   */
  async indexFile(fileId: string): Promise<{ indexed: boolean; reason?: string }> {
    const response = await fetch(apiUrl('/api/ai/index'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ fileId }),
    });

    if (!response.ok) throw await httpErrorFrom(response, 'Failed to index the file');
    return response.json();
  },

  /**
   * Files this account has that the index does not.
   *
   * Two reads and a subtraction in the browser rather than a view or an RPC:
   * an account holds tens of files, both tables are already readable by their
   * owner, and a database object exists forever once it is written.
   */
  async unindexedFileIds(userId: string): Promise<string[]> {
    const [files, indexed] = await Promise.all([
      supabase.from('files').select('id').eq('user_id', userId),
      supabase.from('file_embeddings').select('file_id').eq('user_id', userId),
    ]);

    if (files.error) throw files.error;
    if (indexed.error) throw indexed.error;

    const done = new Set((indexed.data ?? []).map((row) => (row as { file_id: string }).file_id));
    return (files.data ?? [])
      .map((row) => (row as { id: string }).id)
      .filter((id) => !done.has(id));
  },

  /**
   * Indexes a list of files, one at a time.
   *
   * Sequential on purpose. Every call spends a request at a model provider
   * with a rate limit of its own, and a `Promise.all` over a folder of
   * photographs is the shape of request that gets an account throttled. A
   * file that fails is counted and skipped rather than stopping the run.
   */
  async indexMany(
    fileIds: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ indexed: number; skipped: number; failed: number }> {
    const result = { indexed: 0, skipped: 0, failed: 0 };

    for (const [i, fileId] of fileIds.entries()) {
      try {
        const outcome = await this.indexFile(fileId);
        if (outcome.indexed) result.indexed += 1;
        else result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        Sentry.captureException(error, { tags: { context: 'ai.indexMany' } });
      }
      onProgress?.(i + 1, fileIds.length);
    }

    return result;
  },

  /**
   * Files that mean what the query means, nearest first.
   */
  async smartSearch(query: string): Promise<SmartResult[]> {
    const text = query.trim();
    if (!text) return [];

    const response = await fetch(apiUrl('/api/ai/embed'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw await httpErrorFrom(response, 'Failed to understand the search');

    const { embedding, model } = (await response.json()) as { embedding: number[]; model: string };

    const { data, error } = await supabase.rpc('match_files', {
      query_embedding: toVectorLiteral(embedding),
      /* Which model made this vector, so the database compares it only with
         rows made by the same one. Two models place the same sentence in
         different places, and a distance measured across them ranks nonsense
         first. It travels with the vector rather than being configured here
         because the server picks the backend, not the browser. */
      model_name: model,
      match_count: SEARCH_RESULTS,
      min_similarity: SEARCH_MIN_SIMILARITY,
    });

    if (error) {
      /* Deploy order, as in lib/quota.ts: the function arrives with
         migrations/011, and PostgREST's own words for its absence name
         neither the function nor the file that creates it. */
      if (/match_files/.test(error.message) || error.code === 'PGRST202') {
        throw new Error(
          'Smart search is not set up on this database — apply migrations/011_add_file_embeddings.sql'
        );
      }
      Sentry.captureException(error, { tags: { context: 'ai.smartSearch' } });
      throw error;
    }

    return (data || []) as SmartResult[];
  },
};

export default aiService;
