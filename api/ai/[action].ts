import type { VercelRequest, VercelResponse } from '../../libs/server/src/vercel';
import { authenticate, AuthError, supabase, supabaseAsCaller } from '../../libs/server/src/auth';
import {
  EXCERPTS_PER_QUESTION,
  MAX_QUESTION_CHARS,
  type Excerpt,
} from '../../libs/server/src/answer';
import { AnswerRefused } from '../../libs/server/src/claude-answer';
import { isDemoEmail } from '../../libs/server/src/demo';
import {
  MAX_DESCRIBE_BYTES,
  ProviderNotConfigured,
  SEARCH_RESULTS,
  TEXT_SAMPLE_BYTES,
  embeddingInput,
  planFor,
  searchFloor,
  toVectorLiteral,
  type IndexPlan,
  type IndexableFile,
} from '../../libs/core/src/ai';
import { pieceInput } from '../../libs/core/src/chunks';
import { FileTooLarge, fetchBytes } from '../../libs/server/src/fetch-bytes';
import { ownsStoredPath } from '../../libs/core/src/stored-path';
import { signOwnedPath } from '../../libs/server/src/sign-owned-path';
import { cloudinaryUrlIsOwned } from '../../libs/server/src/stored-url';
import {
  DESCRIBE_COPY_TYPE,
  cloudinaryCopyForDescribing,
} from '../../libs/server/src/cloudinary-resize';
import { activeBackend, type AiBackend } from '../../libs/server/src/ai-provider';
import { isConfigured as cloudflareConfigured } from '../../libs/server/src/cloudflare-ai';
import { pdfText } from '../../libs/server/src/to-markdown';
import { decodeText } from '../../libs/server/src/decode-text';
import { piecesOf } from '../../libs/server/src/pieces';
import { BudgetSpent, claimAiCall, secondsUntilTomorrow } from '../../libs/server/src/ai-budget';
import type { DescribeSource } from '../../libs/server/src/describe';
import {
  AI_ASK_LIMIT,
  AI_EMBED_LIMIT,
  AI_INDEX_LIMIT,
  AI_IP_LIMIT,
  MCP_IP_LIMIT,
  MCP_LIMIT,
  RateLimiter,
  clientIp,
  tooManyRequests,
} from '../../libs/server/src/rate-limit';
import { applyCors } from '../../libs/server/src/cors';
import { report } from '../../libs/server/src/report';
import { mcpChallenge, protectedResourceMetadata } from '../../libs/server/src/mcp-resource';
import {
  ToolRefusal,
  folderPaths,
  type FileTools,
  type ListOptions,
} from '../../libs/server/src/mcp-tools';

/**
 * What search by meaning, and asking one's files, need a secret for:
 *
 *   POST /api/ai/index   describe one file, cut its text into pieces, store the vectors
 *   POST /api/ai/embed   turn a search box into a vector
 *   POST /api/ai/ask     answer a question from the pieces nearest to it (ADR 0019)
 *   POST /mcp            the same search and answer, and a listing, as tools an
 *                        assistant calls (ADR 0020); vercel.json rewrites it here
 *   GET  /.well-known/oauth-protected-resource/mcp
 *                        where an assistant signs in for /mcp (RFC 9728), as
 *                        action `resource`
 *
 * One file for both, because Vercel makes a function out of every file under
 * api/ and the Hobby plan allows twelve — this is the twelfth. See
 * docs/decisions/0008-two-actions-one-function.md.
 *
 * What is *not* here is the dashboard's search itself. The vector comes back
 * to the browser and the browser asks the database, under its own session,
 * through `match_files` — the same way the dashboard already reads its rows.
 * An assistant has no database session of its own, so `/mcp` makes that read
 * here, with the caller's token through `supabaseAsCaller`, as `/ask` reads
 * the pieces: the database's policies still decide whose rows they are. See
 * migrations/011_add_file_embeddings.sql.
 */

/** A row pointing somewhere it should not. Answered with 403, not 500. */
class AccessError extends Error {}

const byAddress = new RateLimiter(AI_IP_LIMIT);
const byIndexingUser = new RateLimiter(AI_INDEX_LIMIT);
const byEmbeddingUser = new RateLimiter(AI_EMBED_LIMIT);
const byAskingUser = new RateLimiter(AI_ASK_LIMIT);
const byMcpAddress = new RateLimiter(MCP_IP_LIMIT);
const byMcpUser = new RateLimiter(MCP_LIMIT);

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

/**
 * Whether a picture is larger than this backend's model takes and must be
 * described from a smaller copy, which only Cloudinary makes for free
 * (libs/server/src/cloudinary-resize.ts).
 */
function overModelLimit(file: FileRow, backend: AiBackend): boolean {
  return backend.maxImageBytes !== undefined && file.size > backend.maxImageBytes;
}

function tooLarge(maxBytes: number): string {
  return `this file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB this deployment's model can look at`;
}

/** What a file is described from, and the text its pieces are cut from. */
interface Reading {
  source: DescribeSource;
  /** The file's text; null for a picture, which is cut from its description. */
  text: string | null;
}

/** The start of a text, as much as a description is given: whole bytes. */
function sample(text: string): string {
  return Buffer.from(text, 'utf8').subarray(0, TEXT_SAMPLE_BYTES).toString('utf8');
}

async function readFile(
  file: FileRow,
  plan: IndexPlan & { kind: 'image' | 'pdf' | 'text' },
  userId: string,
  backend: AiBackend
): Promise<Reading> {
  const url = await readableUrl(file, userId);

  if (plan.kind === 'image') {
    // By link rather than by value: the bytes are already behind a URL that
    // outlives this request, and a photograph held in a serverless function
    // is memory and a round trip spent to say the same thing.
    const copy =
      overModelLimit(file, backend) && file.storage_type === 'cloudinary'
        ? cloudinaryCopyForDescribing(url)
        : null;
    /* A copy still over the limit when it arrives is refused by fetchBytes,
       and that is a skip with the reason, as before. */
    return copy
      ? { source: { kind: 'image', url: copy, mediaType: DESCRIBE_COPY_TYPE }, text: null }
      : { source: { kind: 'image', url, mediaType: file.type }, text: null };
  }

  const bytes = await fetchBytes(url, MAX_DESCRIBE_BYTES);

  if (plan.kind === 'pdf') {
    /* The text comes from Cloudflare's toMarkdown wherever the deployment has
       the account: the free path needs it to describe the file at all, and
       both need it for the pieces. Claude without Cloudflare reads the PDF
       itself, and its pieces are cut from the description. */
    const text = cloudflareConfigured()
      ? await pdfText(bytes, file.name).catch(async (error: unknown) => {
          /* Claude reads the PDF itself and needs the text only for the
             pieces, which can be cut from its description instead: a
             converter that is down is reported, not a file left unindexed.
             The free path has nothing else to describe the file from. */
          if (!backend.readsPdf) throw error;
          await report(error, { route: 'ai/index', userId, level: 'warning' });
          return null;
        })
      : null;
    if (backend.readsPdf) {
      return { source: { kind: 'pdf', data: bytes.toString('base64') }, text };
    }
    return { source: { kind: 'text', text: sample(text ?? '') }, text };
  }

  /* Decoded whole for the pieces, sliced for the description: a description
     reads the start of a file, a question may be about its end. UTF-16 is
     read by its mark, and no NUL is kept (libs/server/src/decode-text.ts). */
  const text = decodeText(bytes);
  return { source: { kind: 'text', text: sample(text) }, text };
}

/** Replaces a file's pieces with these, under this backend's model. */
async function storePieces(
  file: FileRow,
  userId: string,
  backend: AiBackend,
  pieces: string[]
): Promise<void> {
  const vectors = await backend.embedMany(
    pieces.map((piece) => pieceInput(file.name, piece)),
    'document'
  );

  /* Delete, then insert: a re-index under another model, or of a file that
     changed, can leave fewer pieces than before, and an upsert would keep the
     rest. Between the two statements the file has no pieces, and the
     dashboard offers it again, which is the honest state of a half-written
     index. */
  const { error: deleteError } = await supabase
    .from('file_chunks')
    .delete()
    .eq('file_id', file.id)
    .eq('user_id', userId);
  if (deleteError) throw indexTableError('Could not replace the pieces', deleteError);

  const { error: insertError } = await supabase.from('file_chunks').insert(
    pieces.map((content, index) => ({
      file_id: file.id,
      chunk_index: index,
      user_id: userId,
      content,
      embedding: toVectorLiteral(vectors[index] as number[]),
      embedding_model: backend.embeddingModel,
    }))
  );
  if (insertError) throw indexTableError('Could not store the pieces', insertError);
}

/**
 * A failure to read or write `file_embeddings`, naming the migration when the
 * table is not there. Deploy order, as in libs/server/src/quota.ts: the table
 * arrives with migrations/011, and "relation does not exist" points at nothing
 * on its own.
 */
function indexTableError(doing: string, error: { message: string }): Error {
  if (/file_embeddings/.test(error.message)) {
    return new Error(
      `${doing}: ${error.message} — has migrations/011_add_file_embeddings.sql been run?`
    );
  }
  if (/file_chunks|match_chunks/.test(error.message)) {
    return new Error(
      `${doing}: ${error.message} — has migrations/022_add_file_chunks.sql been run?`
    );
  }
  return new Error(`${doing}: ${error.message}`);
}

/**
 * Describes one file, cuts its text into pieces, and keeps both.
 *
 * Idempotent by design, in rows and in money. A file this embedding model has
 * indexed, sentence and pieces, gets its stored description back without a
 * model being asked again. A file with the sentence and no pieces, indexed
 * before the pieces existed or interrupted between the two writes, gets its
 * pieces and keeps its sentence. Under another model both are replaced rather
 * than added to. A run can be repeated without thinking about it.
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

  /* A picture larger than this backend's model takes is skipped with the
     reason, before anything is paid for, unless it is on Cloudinary, which
     makes a smaller copy to describe instead (readFile). The size on the row
     is the provider's since migration 020, not the browser's; `fetchBytes`
     still refuses a larger file when it arrives, and that is a skip too. */
  const limit = backend.maxImageBytes;
  if (
    plan.kind === 'image' &&
    limit !== undefined &&
    file.size > limit &&
    file.storage_type !== 'cloudinary'
  ) {
    res.status(200).json({ indexed: false, reason: tooLarge(limit) });
    return;
  }

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

  /* Once per embedding model. The dashboard offers only the files the model
     on screen has not indexed, but this route can be called without it, and
     every description is paid for: a row that is already here is the answer
     to give again, not a reason to ask a model again. A row another model
     made is not, because the search cannot compare it (migrations/011). */
  const [{ data: rows, error: readError }, { data: pieceRows, error: piecesError }] =
    await Promise.all([
      supabase
        .from('file_embeddings')
        .select('summary, tags, summary_model')
        .eq('file_id', file.id)
        .eq('user_id', userId)
        .eq('embedding_model', backend.embeddingModel)
        .limit(1),
      supabase
        .from('file_chunks')
        .select('chunk_index')
        .eq('file_id', file.id)
        .eq('user_id', userId)
        .eq('embedding_model', backend.embeddingModel)
        .eq('chunk_index', 0)
        .limit(1),
    ]);

  if (readError) throw indexTableError('Could not read the index', readError);
  if (piecesError) throw indexTableError('Could not read the pieces', piecesError);

  const indexed = (
    rows as { summary: string; tags: string[]; summary_model: string }[] | null
  )?.[0];
  if (indexed && (pieceRows as unknown[] | null)?.length) {
    res.status(200).json({
      indexed: true,
      summary: indexed.summary,
      tags: indexed.tags,
      model: indexed.summary_model,
    });
    return;
  }

  /* A picture already described needs nothing read again: its pieces are cut
     from the description. Anything else is read for its text, before the
     budget is touched, since reading costs nothing and a scan with no text
     is refused here rather than paid for. */
  const reading =
    indexed && plan.kind === 'image' ? null : await readFile(file, plan, userId, backend);

  if (plan.kind === 'pdf' && !backend.readsPdf && !reading?.text?.trim()) {
    res.status(200).json({
      indexed: false,
      reason: 'this PDF has no text to read; a scanned page is a picture of text',
    });
    return;
  }

  /* The last check before the money, after every refusal that costs nothing
     (libs/server/src/ai-budget.ts). One unit a file, its pieces included. */
  await claimAiCall(userId, 'index');

  let description: { summary: string; tags: string[]; model: string };
  if (indexed) {
    description = { summary: indexed.summary, tags: indexed.tags, model: indexed.summary_model };
  } else {
    const described = await backend.describe(file.name, (reading as Reading).source);
    const vector = await backend.embed(
      embeddingInput(file, described.summary, described.tags),
      'document'
    );

    const { error: writeError } = await supabase.from('file_embeddings').upsert(
      {
        file_id: file.id,
        user_id: userId,
        summary: described.summary,
        tags: described.tags,
        embedding: toVectorLiteral(vector),
        summary_model: described.model,
        embedding_model: backend.embeddingModel,
        indexed_at: new Date().toISOString(),
      },
      { onConflict: 'file_id' }
    );

    if (writeError) throw indexTableError('Could not store the index', writeError);
    description = described;
  }

  const pieces = piecesOf(reading?.text ?? null, description.summary);
  await storePieces(file, userId, backend, pieces);

  res.status(200).json({
    indexed: true,
    summary: description.summary,
    tags: description.tags,
    model: description.model,
    pieces: pieces.length,
  });
}

/**
 * The pieces nearest to a question, numbered as the answer cites them, found
 * by the caller's own search under the database's policies: `match_chunks` is
 * not the service role's to call (migration 022).
 */
async function nearestPieces(
  req: VercelRequest,
  vector: number[],
  model: string
): Promise<Excerpt[]> {
  const { data, error } = await supabaseAsCaller(req).rpc('match_chunks', {
    query_embedding: toVectorLiteral(vector),
    model_name: model,
    match_count: EXCERPTS_PER_QUESTION,
    min_similarity: 0,
  });
  if (error) throw indexTableError('Could not search the pieces', error);

  const rows = (data ?? []) as {
    file_id: string;
    file_name: string;
    chunk_index: number;
    content: string;
  }[];
  return rows.map((row, i) => ({
    n: i + 1,
    fileId: row.file_id,
    fileName: row.file_name,
    chunkIndex: row.chunk_index,
    content: row.content,
  }));
}

/**
 * Answers a question from the caller's files, as it is written.
 *
 * The answer comes as lines of JSON (`application/x-ndjson`), so that the
 * browser can show the sources at once and the words as they arrive:
 *
 *   {"type":"sources","model":…,"sources":[{"n":1,"fileId":…,"fileName":…,"chunkIndex":…,"content":…}]}
 *   {"type":"text","text":"…"}            any number of these
 *   {"type":"done"}                       or {"type":"error","message":…}
 *
 * Everything that can refuse does so before the first line, with a status
 * the handler chooses. Once the stream has begun the status is spent, so a
 * failure in the middle of an answer is a line of its own.
 *
 * Any account may ask, a demo's included: the answer is free on the path
 * production runs, and the day's budget is what keeps one visitor from
 * spending everyone's share.
 */
async function askQuestion(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
  const { question } = req.body as { question?: unknown };
  const text = typeof question === 'string' ? question.trim() : '';

  if (!text) {
    res.status(400).json({ message: 'question is required' });
    return;
  }
  if ([...text].length > MAX_QUESTION_CHARS) {
    res.status(400).json({ message: 'question is too long' });
    return;
  }

  /* The person closed the screen or pressed Stop: the connection closes
     before the answer is written, and the model is told to stop rather than
     finish a reply nobody reads, out of the same free allocation. Watched
     from here, not from the first word: Stop pressed while the pieces are
     still being found closes the connection before there is an answer, and
     a listener added after that never hears it. On Vercel the function is
     told at all only with `supportsCancellation` (vercel.json). */
  const left = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) left.abort();
  });

  const backend = activeBackend();

  /* One unit a question, its search included, claimed before the first call
     that costs (libs/server/src/ai-budget.ts). */
  await claimAiCall(userId, 'ask');

  const vector = await backend.embed(text, 'query');
  const excerpts = await nearestPieces(req, vector, backend.embeddingModel);

  // Gone while the pieces were found: no model is asked for an answer nobody waits for.
  if (left.signal.aborted) {
    res.end();
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`);

  send({
    type: 'sources',
    model: backend.answerModel,
    sources: excerpts.map(({ n, fileId, fileName, chunkIndex, content }) => ({
      n,
      fileId,
      fileName,
      chunkIndex,
      content,
    })),
  });

  /* Nothing indexed to read: no model is asked to answer from nothing, and
     the browser says what to do instead. */
  if (excerpts.length === 0) {
    send({ type: 'done', empty: true });
    res.end();
    return;
  }

  try {
    for await (const piece of backend.answer(excerpts, text, left.signal)) {
      if (left.signal.aborted) break;
      send({ type: 'text', text: piece });
    }
    if (!left.signal.aborted) send({ type: 'done' });
  } catch (error) {
    // Nobody is there to tell, and a stop asked for is not a failure.
    if (!left.signal.aborted) {
      console.error('[ai]', error);
      if (!(error instanceof AnswerRefused)) await report(error, { route: 'ai/ask', userId });
      send({
        type: 'error',
        message:
          error instanceof AnswerRefused
            ? error.message
            : 'The answer could not be finished. Try asking again.',
      });
    }
  }
  res.end();
}

/** Turns what someone typed into the vector the database can compare. */
async function embedQuery(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
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

  /* After the backend: a deployment with no keys answers 501 without asking
     the database anything (libs/server/src/ai-budget.ts). */
  await claimAiCall(userId, 'embed');

  res.status(200).json({
    embedding: await backend.embed(query, 'query'),
    /* The browser passes this straight back to `match_files`, which only
       compares rows made by the same model — so the name travelling with the
       vector is what keeps a search honest after a backend change. */
    model: backend.embeddingModel,
  });
}

/** A per-account limit, said to the model in words: a tool's error, not a 429. */
function allowOrRefuse(limiter: RateLimiter, userId: string, what: string): void {
  if (limiter.allow(userId)) return;
  throw new ToolRefusal(`${what} Try again in ${limiter.retryAfterSeconds(userId)} seconds.`);
}

/**
 * What the pages are told with a status, a tool's caller is told in words: a
 * spent budget, a deployment with no model, a model that declined. Anything
 * else stays a failure.
 */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BudgetSpent) {
      if (error.scope === 'deployment') {
        console.warn('[ai]', error.message);
        await report(error, { route: 'ai/mcp', level: 'warning' });
      }
      throw new ToolRefusal(`${error.message} The day's budget starts again at midnight UTC.`);
    }
    if (error instanceof ProviderNotConfigured || error instanceof AnswerRefused) {
      throw new ToolRefusal(error.message);
    }
    throw error;
  }
}

type CallerDb = ReturnType<typeof supabaseAsCaller>;

/** Every folder of the caller's, by id, as a path: "Taxes/2026". */
async function folderPathsOf(db: CallerDb): Promise<Map<string, string>> {
  const { data, error } = await db.from('folders').select('id, name, parent_id');
  if (error) throw new Error(`Could not read the folders: ${error.message}`);
  return folderPaths((data ?? []) as { id: string; name: string; parent_id: string | null }[]);
}

/** A path as a person or a model may write it: "/Taxes/2026/" is "Taxes/2026". */
function plainPath(path: string): string {
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === '/') start++;
  while (end > start && path[end - 1] === '/') end--;
  return path.slice(start, end);
}

interface ListedRow {
  id: string;
  name: string;
  type: string;
  size: number;
  folder_id: string | null;
  created_at: string;
}

/**
 * The tools of `/mcp` for one caller (ADR 0020), over what the pages use: the
 * search `match_files` makes for the dashboard, the pieces and the answer of
 * `/ask`, the rows the dashboard lists. Every read is the caller's own,
 * through their token and the database's policies, as `/ask` reads the
 * pieces; nothing here writes.
 *
 * The budgets are the pages' too: a search claims `embed`, a question `ask`,
 * a listing nothing, since it asks no model.
 */
function fileToolsFor(req: VercelRequest, userId: string, signal: AbortSignal): FileTools {
  return {
    search: (query) =>
      refusing(async () => {
        allowOrRefuse(byEmbeddingUser, userId, 'Too many searches.');
        const backend = activeBackend();
        await claimAiCall(userId, 'embed');
        const vector = await backend.embed(query, 'query');

        const db = supabaseAsCaller(req);
        const [{ data, error }, folders] = await Promise.all([
          db.rpc('match_files', {
            query_embedding: toVectorLiteral(vector),
            model_name: backend.embeddingModel,
            match_count: SEARCH_RESULTS,
            min_similarity: searchFloor(backend.embeddingModel),
          }),
          folderPathsOf(db),
        ]);
        if (error) throw indexTableError('Could not search the files', error);

        const rows = (data ?? []) as (ListedRow & { summary: string; similarity: number })[];
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          size: row.size,
          folder: row.folder_id ? (folders.get(row.folder_id) ?? null) : null,
          addedAt: row.created_at,
          description: row.summary,
          similarity: row.similarity,
        }));
      }),

    ask: (question) =>
      refusing(async () => {
        allowOrRefuse(byAskingUser, userId, 'Too many questions at once.');
        const backend = activeBackend();
        await claimAiCall(userId, 'ask');
        const vector = await backend.embed(question, 'query');
        const excerpts = await nearestPieces(req, vector, backend.embeddingModel);
        const sources = excerpts.map(({ n, fileId, fileName, chunkIndex, content }) => ({
          n,
          fileId,
          fileName,
          piece: chunkIndex,
          text: content,
        }));

        // As /ask: nothing indexed, and no model is asked to answer from nothing.
        if (excerpts.length === 0) return { answer: null, model: backend.answerModel, sources };

        /* Whole rather than streamed: a tool returns one result. `signal`
           stops the model when the caller goes, as Stop does on the page. */
        let answer = '';
        for await (const piece of backend.answer(excerpts, question, signal)) answer += piece;
        return { answer, model: backend.answerModel, sources };
      }),

    list: async ({ folder, limit, offset }: ListOptions) => {
      const db = supabaseAsCaller(req);
      const folders = await folderPathsOf(db);

      /* Which folder, before anything is read: null for the top, the ids of
         one path, or every file. Two folders of one name under one parent
         have one path, and both are listed. */
      let inFolders: string[] | null | undefined;
      if (folder !== undefined) {
        const wanted = plainPath(folder);
        inFolders =
          wanted === '' ? null : [...folders].filter(([, p]) => p === wanted).map(([id]) => id);
        if (inFolders?.length === 0) {
          throw new ToolRefusal(
            `There is no folder "${folder}". list_files without a folder lists every folder.`
          );
        }
      }

      /* One row past the page, to say whether there is another: cheaper than
         counting the whole table for a yes or no. */
      let query = db
        .from('files')
        .select('id, name, type, size, folder_id, created_at')
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + limit);
      if (inFolders === null) query = query.is('folder_id', null);
      else if (inFolders) query = query.in('folder_id', inFolders);

      const { data, error } = await query;
      if (error) throw new Error(`Could not list the files: ${error.message}`);
      const rows = (data ?? []) as ListedRow[];

      return {
        files: rows.slice(0, limit).map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          size: row.size,
          folder: row.folder_id ? (folders.get(row.folder_id) ?? null) : null,
          addedAt: row.created_at,
        })),
        folders: [...new Set(folders.values())].sort(),
        more: rows.length > limit,
      };
    },
  };
}

/** One request of an assistant's, answered by the tools above (ADR 0020). */
async function answerMcp(req: VercelRequest, res: VercelResponse, userId: string): Promise<void> {
  /* As /ask: the caller gone, the model is stopped rather than left to finish
     out of the same free allocation (`supportsCancellation`, vercel.json). */
  const left = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) left.abort();
  });

  /* Loaded here, not at the top: the SDK is some 940 kB of code, and every
     other action of this function, the pages' search and questions among
     them, would otherwise load it at each cold start. */
  const { mcpServer, serveMcp } = await import('../../libs/server/src/mcp');

  const tools = fileToolsFor(req, userId, left.signal);
  await serveMcp(
    req,
    res,
    () =>
      mcpServer(tools, async (error, tool) => {
        // A stop asked for is not a failure, and nobody is there to tell.
        if (left.signal.aborted) return;
        console.error('[ai]', error);
        await report(error, { route: 'ai/mcp', userId, extra: { tool } });
      }),
    left.signal
  );
}

/**
 * Where an assistant signs in for `/mcp` (RFC 9728). Public, and read by any
 * page: an assistant in a browser, the MCP Inspector, fetches it from its own
 * origin before it has a token, so it is told it may, preflight included.
 * Nothing here is a secret; the project's URL is in the app's bundle already.
 */
function answerResourceMetadata(req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error('SUPABASE_URL is not configured');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(protectedResourceMetadata(req.headers.host ?? 'localhost', supabaseUrl));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;

  // Before CORS: its allowlist is the app's shells, and this is for anyone.
  if (action === 'resource') {
    answerResourceMetadata(req, res);
    return;
  }

  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    // `/mcp` included: with no session, there is no stream to GET (the MCP
    // transport's own answer, 405, with what is allowed).
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  /* `/mcp` counts by account once the token is checked (MCP_LIMIT): many
     people's assistants can come from one address. */
  const ip = clientIp(req.headers, req.socket?.remoteAddress);
  const addresses = action === 'mcp' ? byMcpAddress : byAddress;
  if (!addresses.allow(ip)) {
    tooManyRequests(
      res,
      addresses.retryAfterSeconds(ip),
      'Too many requests. Try again in a minute.'
    );
    return;
  }

  /* What a report says the failure was in: one of the actions, or the
     function for a segment that is none of them. */
  const route =
    action === 'index' ||
    action === 'embed' ||
    action === 'ask' ||
    action === 'model' ||
    action === 'mcp'
      ? `ai/${action}`
      : 'ai';

  try {
    // An assistant's token at /mcp only, a person's everywhere else (ADR 0020).
    const user = await authenticate(req, action === 'mcp' ? 'agent' : 'person');
    const userId = user.id;

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

    /* Which model this deployment indexes with. The dashboard needs it to
       tell which files are missing from the index (one indexed by another
       model is), and until now learned it only from a search's answer, so
       "Index them" appeared only after a search by meaning. Costs nothing:
       no model is asked, nothing is claimed. */
    if (action === 'model') {
      res.status(200).json({ model: activeBackend().embeddingModel });
      return;
    }

    /* An assistant's tools (ADR 0020), for a token Supabase's OAuth server
       issued it. A demo account is refused: it is gone within a day, and an
       assistant connected to it would outlive it. */
    if (action === 'mcp') {
      if (!byMcpUser.allow(userId)) {
        tooManyRequests(
          res,
          byMcpUser.retryAfterSeconds(userId),
          'Too many requests. Try again in a minute.'
        );
        return;
      }
      if (isDemoEmail(user.email)) {
        res.status(403).json({
          message:
            'A demo account cannot connect an assistant: it is erased within a day. Sign up to connect one.',
        });
        return;
      }
      await answerMcp(req, res, userId);
      return;
    }

    if (action === 'ask') {
      if (!byAskingUser.allow(userId)) {
        tooManyRequests(
          res,
          byAskingUser.retryAfterSeconds(userId),
          'Too many questions at once. Try again in a minute.'
        );
        return;
      }
      await askQuestion(req, res, userId);
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
    await embedQuery(req, res, userId);
  } catch (error) {
    /* Not a failure: the day's budget doing its job. Said with Retry-After, so
       a client that reads it comes back after midnight UTC rather than in a
       second. */
    if (error instanceof BudgetSpent) {
      /* The deployment's budget is the one its owner sets, and reaching it is
         worth knowing about the same day. */
      if (error.scope === 'deployment') {
        console.warn('[ai]', error.message);
        await report(error, { route, level: 'warning' });
      }
      tooManyRequests(res, secondsUntilTomorrow(), error.message);
      return;
    }

    /* A file over a ceiling is a reason not to index it, said as the skips
       are, not a failure of the server: nothing went wrong, and nothing is
       reported. */
    if (error instanceof FileTooLarge) {
      res.status(200).json({ indexed: false, reason: tooLarge(error.maxBytes) });
      return;
    }

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

    if (!(error instanceof AuthError)) await report(error, { route });
    /* Where to sign in, for an assistant that has no token /mcp takes yet:
       this is what starts its OAuth flow (RFC 9728). */
    if (error instanceof AuthError && action === 'mcp') {
      res.setHeader(
        'WWW-Authenticate',
        mcpChallenge(req.headers.host ?? 'localhost', Boolean(req.headers.authorization))
      );
    }
    res.status(error instanceof AuthError ? 401 : 500).json({
      message: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
}
