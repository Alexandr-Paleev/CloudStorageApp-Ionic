import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate, AuthError, supabase } from '../../libs/server/src/auth';
import { isDemoEmail } from '../../libs/server/src/demo';
import {
  MAX_DESCRIBE_BYTES,
  ProviderNotConfigured,
  TEXT_SAMPLE_BYTES,
  cloudinaryUrlIsOwned,
  embeddingInput,
  planFor,
  toVectorLiteral,
  type IndexPlan,
  type IndexableFile,
} from '../../libs/core/src/ai';
import { fetchBytes } from '../../libs/server/src/fetch-bytes';
import { ownsStoredPath } from '../../libs/core/src/stored-path';
import { signOwnedPath } from '../../libs/server/src/sign-owned-path';
import { activeBackend } from '../../libs/server/src/ai-provider';
import type { DescribeSource } from '../../libs/server/src/describe';
import {
  AI_EMBED_LIMIT,
  AI_INDEX_LIMIT,
  AI_IP_LIMIT,
  RateLimiter,
  clientIp,
  tooManyRequests,
} from '../../libs/server/src/rate-limit';
import { applyCors } from '../../libs/server/src/cors';

/**
 * The two halves of semantic search that need a secret:
 *
 *   POST /api/ai/index   describe one file and store its vector
 *   POST /api/ai/embed   turn a search box into a vector
 *
 * One file for both, because Vercel makes a function out of every file under
 * api/ and the Hobby plan allows twelve — this is the twelfth. See
 * docs/decisions/0008-two-actions-one-function.md.
 *
 * What is *not* here is the search itself. The vector comes back to the
 * browser and the browser asks the database, under its own session, through
 * `match_files` — the same way the dashboard already reads its rows. Routing
 * that read through this function would mean holding a second Supabase client
 * with the anon key here, and the RLS that makes the answer correct would then
 * depend on this file getting the token forwarding right instead of on the
 * database. See migrations/011_add_file_embeddings.sql.
 */

/** A row pointing somewhere it should not. Answered with 403, not 500. */
class AccessError extends Error {}

const byAddress = new RateLimiter(AI_IP_LIMIT);
const byIndexingUser = new RateLimiter(AI_INDEX_LIMIT);
const byEmbeddingUser = new RateLimiter(AI_EMBED_LIMIT);

/** Long enough to fetch a file, short enough that nothing else can use it. */
const READ_URL_TTL = 300;

interface FileRow extends IndexableFile {
  id: string;
  download_url: string;
  storage_path: string;
}

/**
 * A URL the bytes can actually be read through — and only the caller's own.
 *
 * `download_url` on the row is only a URL in the sense that it was one when it
 * was written: for the two private backends it is a signed link that has long
 * since expired. Cloudinary is the exception and the common case, where the
 * stored value is a permanent delivery URL — and therefore the one value here
 * that the browser both writes and this function obeys, which is why it is
 * checked rather than used.
 */
async function readableUrl(file: FileRow, userId: string): Promise<string> {
  const signed = await signOwnedPath(file, userId, READ_URL_TTL);
  if (signed) return signed;

  if (!cloudinaryUrlIsOwned(file.download_url, userId)) {
    throw new AccessError('that file does not point at your own Cloudinary folder');
  }
  return file.download_url;
}

async function sourceFor(
  file: FileRow,
  plan: IndexPlan & { kind: 'image' | 'pdf' | 'text' },
  userId: string
) {
  const url = await readableUrl(file, userId);

  if (plan.kind === 'image') {
    // By link rather than by value: the bytes are already behind a URL that
    // outlives this request, and a photograph held in a serverless function
    // is memory and a round trip spent to say the same thing.
    return { kind: 'image', url, mediaType: file.type } satisfies DescribeSource;
  }

  const bytes = await fetchBytes(url, MAX_DESCRIBE_BYTES);

  if (plan.kind === 'pdf') {
    return { kind: 'pdf', data: bytes.toString('base64') } satisfies DescribeSource;
  }

  /* Sliced as bytes, decoded after: cutting a UTF-8 string by character count
     would still send the whole file through the decoder, and cutting the
     buffer mid-codepoint only costs the last character. */
  return {
    kind: 'text',
    text: bytes.subarray(0, TEXT_SAMPLE_BYTES).toString('utf8'),
  } satisfies DescribeSource;
}

/**
 * Describes one file and keeps the result.
 *
 * Idempotent by design: the row is keyed by the file, so re-indexing after a
 * prompt change overwrites rather than accumulates, and a backfill can be run
 * twice without thinking about it.
 */
async function indexFile(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
  const { fileId } = req.body as { fileId?: string };
  if (!fileId) {
    res.status(400).json({ message: 'fileId is required' });
    return;
  }

  /* Owner in the query, not in a check afterwards. The service-role key
     bypasses RLS, so this is the only thing standing between a caller and
     somebody else's file — and a filter cannot be forgotten the way a
     subsequent `if` can. */
  const { data, error } = await supabase
    .from('files')
    .select('id, name, type, size, storage_type, storage_path, download_url')
    .eq('id', fileId)
    .eq('user_id', userId)
    .limit(1);

  if (error) throw new Error(`Could not read the file row: ${error.message}`);

  const file = (data as FileRow[] | null)?.[0];
  if (!file) {
    // 404 rather than 403: the row was looked up by id *and* owner, so the
    // honest answer is that the caller has no such file, and saying which of
    // the two failed would tell them whether the id exists at all.
    res.status(404).json({ message: 'File not found' });
    return;
  }

  const plan = planFor(file);
  if (plan.kind === 'skip') {
    // 200, not an error: nothing went wrong, this file simply will not appear
    // in a smart search, and the caller is told why rather than left to wonder.
    res.status(200).json({ indexed: false, reason: plan.reason });
    return;
  }

  /* After the skip, before anything is signed or fetched: ownership only
     matters for the providers whose bytes this service reads, and a file in
     someone's own Drive deserves the honest "not indexed, here is why" rather
     than a refusal. The row said this path is the caller's, and the row is
     written by the caller — the service-role key below consults neither RLS,
     nor Storage's policies, nor the bucket. */
  if (!ownsStoredPath(file, userId)) {
    res.status(403).json({ message: 'That file is not stored where your files are' });
    return;
  }

  /* Resolved here rather than at module scope: which backend is active is a
     property of the environment, and a module read once at cold start would
     survive a variable being added in the dashboard. */
  const backend = activeBackend();

  if (!backend.supports(plan.kind)) {
    // The same shape of answer as a skip, because that is what it is — this
    // deployment's backend cannot read that kind of file. Saying so beats
    // storing a confident sentence about something nobody looked at.
    res.status(200).json({
      indexed: false,
      reason: `this deployment's model cannot read ${plan.kind} files`,
    });
    return;
  }

  const description = await backend.describe(file.name, await sourceFor(file, plan, userId));
  const vector = await backend.embed(
    embeddingInput(file, description.summary, description.tags),
    'document'
  );

  const { error: writeError } = await supabase.from('file_embeddings').upsert(
    {
      file_id: file.id,
      user_id: userId,
      summary: description.summary,
      tags: description.tags,
      embedding: toVectorLiteral(vector),
      summary_model: description.model,
      embedding_model: backend.embeddingModel,
      indexed_at: new Date().toISOString(),
    },
    { onConflict: 'file_id' }
  );

  if (writeError) {
    // Deploy order, as in libs/server/src/quota.ts: the table arrives with migrations/011,
    // and "relation does not exist" points at nothing on its own.
    if (/file_embeddings/.test(writeError.message)) {
      throw new Error(
        `Could not store the index: ${writeError.message} — has migrations/011_add_file_embeddings.sql been run?`
      );
    }
    throw new Error(`Could not store the index: ${writeError.message}`);
  }

  res.status(200).json({
    indexed: true,
    summary: description.summary,
    tags: description.tags,
    model: description.model,
  });
}

/** Turns what someone typed into the vector the database can compare. */
async function embedQuery(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { text } = req.body as { text?: string };
  const query = typeof text === 'string' ? text.trim() : '';

  if (!query) {
    res.status(400).json({ message: 'text is required' });
    return;
  }
  if (query.length > 500) {
    // A search box, not a document. The limit is here so a paste of a whole
    // file cannot be embedded at this route's expense.
    res.status(400).json({ message: 'text is too long for a search' });
    return;
  }

  const backend = activeBackend();

  res.status(200).json({
    embedding: await backend.embed(query, 'query'),
    /* The browser passes this straight back to `match_files`, which only
       compares rows made by the same model — so the name travelling with the
       vector is what keeps a search honest after a backend change. */
    model: backend.embeddingModel,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  if (!byAddress.allow(ip)) {
    tooManyRequests(
      res,
      byAddress.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
    return;
  }

  try {
    const user = await authenticate(req);
    const userId = user.id;
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;

    if (action === 'index') {
      /* Describing a file is the one thing this deployment pays a third party
         for, and /api/demo/session hands an account to anyone who opens the
         site. Without this, the bill is a function of how many strangers
         visit. Searching stays open to them — embedding a line of text is
         next to free, and a demo that cannot use the searchbar teaches
         nothing about the feature. */
      if (isDemoEmail(user.email)) {
        res.status(200).json({ indexed: false, reason: 'demo accounts are not indexed' });
        return;
      }

      if (!byIndexingUser.allow(userId)) {
        tooManyRequests(
          res,
          byIndexingUser.retryAfterSeconds(userId),
          'Too many files at once. Try again in a minute.'
        );
        return;
      }
      await indexFile(req, res, userId);
      return;
    }

    if (action !== 'embed') {
      res.status(404).json({ message: `Unknown action "${action ?? ''}"` });
      return;
    }

    // Counted after the action is known, so a misspelled segment cannot spend
    // the allowance of the one it was meant to be (0008).
    if (!byEmbeddingUser.allow(userId)) {
      tooManyRequests(
        res,
        byEmbeddingUser.retryAfterSeconds(userId),
        'Too many searches. Try again in a minute.'
      );
      return;
    }
    await embedQuery(req, res);
  } catch (error) {
    console.error('[ai]', error);

    if (error instanceof AccessError) {
      res.status(403).json({ message: `Access denied: ${error.message}` });
      return;
    }

    if (error instanceof ProviderNotConfigured) {
      // 501: the client cannot see the server's variables, so it keeps
      // offering the feature. A 500 would be retried on the way to the same
      // answer — the same reasoning as the Cloudinary route.
      res.status(501).json({ message: error.message });
      return;
    }

    res.status(error instanceof AuthError ? 401 : 500).json({
      message: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
}
