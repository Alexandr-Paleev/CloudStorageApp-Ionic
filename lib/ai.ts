/**
 * The numbers and the plain functions behind semantic search.
 *
 * Everything here is decided in one place for the same reason `lib/tiers.ts`
 * exists: these values are spelled out in three others — the CHECK
 * constraints in `migrations/011_add_file_embeddings.sql`, the API function
 * that writes the rows, and the eval that scores the result — and a copy that
 * drifts does not throw. It either rejects a row the model wrote, or scores a
 * run against a setup that is no longer the one shipping.
 *
 * Nothing in this file calls out to anything. That is deliberate: what is left
 * is the part worth testing without a network.
 */

/**
 * What writes the sentence.
 *
 * A caption is a short, literal task, so it runs at low effort — the model is
 * being asked what is in a picture, not to reason about it. Thinking stays on
 * (it is on by default on this model, and turning it off has its own failure
 * modes); effort is the lever that makes it cheap.
 */
export const SUMMARY_MODEL = 'claude-opus-5';

/**
 * What turns the sentence into a vector.
 *
 * Anthropic does not publish an embedding model and points at Voyage, which is
 * what this uses. The dimension is the model's default and is written into the
 * `vector(1024)` column: vectors from two models are not comparable, so
 * changing this constant is a new column and a backfill, never an ALTER.
 */
export const EMBEDDING_MODEL = 'voyage-4';
export const EMBEDDING_DIMENSIONS = 1024;

/** Mirrors `CHECK (char_length(summary) BETWEEN 1 AND 500)` in migrations/011. */
export const MAX_SUMMARY_CHARS = 500;
/** Mirrors `CHECK (cardinality(tags) <= 12)` in migrations/011. */
export const MAX_TAGS = 12;
/** No constraint behind this one — a forty-character tag is already a sentence. */
export const MAX_TAG_CHARS = 40;

/** One dashboard page, so a smart search and an ordinary one feel the same. */
export const SEARCH_RESULTS = 15;

/**
 * How close is close enough.
 *
 * A cosine similarity has no natural cut-off: every file in the account is
 * some distance from every query, so without a floor the tenth result is
 * whatever happened to be least unlike it. 0.25 is a starting guess and is
 * expected to move — it is the first thing the eval tunes, which is why it
 * lives here and not in the SQL default.
 */
export const SEARCH_MIN_SIMILARITY = 0.25;

/**
 * Whether the path on a row really belongs to the caller.
 *
 * `files` rows are written by the browser under a policy that says only which
 * *rows* an account may write, never what may go in them — `lib/safe-url.ts`
 * says the same thing about `download_url` one column over. So a caller can
 * put another account's object path into their own row and ask this service
 * to read it: the indexer holds the service-role key, and neither Storage's
 * policies nor R2's bucket care what `auth.uid()` was. `/api/share` asks the
 * same question, for the same reason, before it signs a path for a link.
 *
 * The prefixes are the ones the upload routes create and the R2 route already
 * checks (`ownsKey`, api/r2/[action].ts): Cloudinary signs into
 * `users/<id>/`, R2 writes under `users/<id>/`, and Supabase Storage uses
 * `<id>/` as the first path segment — the same segment its own policies match
 * on. Verified against production before it was written: all 20 rows there
 * follow it.
 *
 * The trailing slash is load-bearing, exactly as it is in `ownsKey`: without
 * it `users/<id>` would authorise `users/<id>0/`.
 *
 * Mirrors `files_storage_path_is_owners` in migrations/013 — a change to one
 * prefix is a change to both.
 */
export function ownsStoredPath(
  file: { storage_type: string; storage_path: string },
  userId: string
): boolean {
  switch (file.storage_type) {
    case 'cloudinary':
    case 'r2':
      return file.storage_path.startsWith(`users/${userId}/`);
    case 'supabase_storage':
      return file.storage_path.startsWith(`${userId}/`);
    default:
      // Google Drive and Dropbox never reach here — planFor() skips them, and
      // /api/share only asks about the two providers it signs for — and an
      // unknown provider is not something to guess about.
      return false;
  }
}

/**
 * Whether a stored Cloudinary delivery URL is one of ours, for this user.
 *
 * Cloudinary is the one provider whose stored URL is used as-is, because it is
 * a permanent delivery link rather than a signature that expired months ago.
 * That makes the column an instruction to fetch, and the column is written by
 * the browser — so without this the route would fetch any `http(s)` address a
 * caller cared to store and hand the answer back as a description.
 *
 * Fails closed on anything unexpected, including a custom delivery domain: a
 * file that stops being indexable is a visible, fixable annoyance, and a
 * server that fetches arbitrary URLs is not.
 */
export function cloudinaryUrlIsOwned(url: string, userId: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'res.cloudinary.com' &&
    parsed.pathname.includes(`/users/${userId}/`)
  );
}

/**
 * The ceiling on an image sent to a model as bytes rather than as a link.
 *
 * Lower than MAX_DESCRIBE_BYTES on purpose. The Workers AI image-to-text
 * schema takes an array of byte values, so a megabyte of picture becomes a
 * megabyte of comma-separated numbers in a JSON body — the function runs out
 * of memory long before the model runs out of patience.
 */
export const MAX_VISION_BYTES = 3 * 1024 * 1024;

/** Bytes the indexer will pull into memory to describe one file. */
export const MAX_DESCRIBE_BYTES = 8 * 1024 * 1024;

/** How much of a text file is enough to describe it. */
export const TEXT_SAMPLE_BYTES = 8 * 1024;

/**
 * A provider this deployment has no key for.
 *
 * Its own error class because the answer is 501 rather than 500: the client
 * cannot see the server's variables, so it will keep offering a feature that
 * was never configured, and a 500 would be retried twice on the way to the
 * same answer. Same reasoning as the Cloudinary route.
 */
export class ProviderNotConfigured extends Error {}

/** Providers whose bytes this deployment can reach with its own credentials. */
const OWN_STORAGE = ['cloudinary', 'r2', 'supabase_storage'];

export interface IndexableFile {
  name: string;
  /** MIME type as recorded on the row. The browser sends '' when it cannot tell. */
  type: string;
  size: number;
  storage_type: string;
}

/** How a file should be shown to the model, or why it will not be. */
export type IndexPlan = { kind: 'image' | 'pdf' | 'text' } | { kind: 'skip'; reason: string };

/**
 * Decides what can be described, and says why when nothing can.
 *
 * The refusals are as much a part of the feature as the successes: a file that
 * is not in the index is one a smart search will never return, and "why is my
 * PowerPoint not found" deserves an answer better than silence.
 */
export function planFor(file: IndexableFile): IndexPlan {
  if (!OWN_STORAGE.includes(file.storage_type)) {
    // Google Drive and Dropbox files live in the user's own cloud, reached
    // with their OAuth grant while they are connected. This app holds no
    // standing authority to read them later, which is the same reason
    // lib/account-erase.ts cannot delete them.
    return { kind: 'skip', reason: `${file.storage_type} files stay in the user's own cloud` };
  }

  if (file.size > MAX_DESCRIBE_BYTES) {
    return { kind: 'skip', reason: 'file is too large to describe' };
  }

  const type = file.type.toLowerCase();

  if (type.startsWith('image/')) {
    // SVG is an image to the browser and a script to everything else; it is
    // also the one image type the model is not sent as an image.
    if (type === 'image/svg+xml') return { kind: 'text' };
    return { kind: 'image' };
  }
  if (type === 'application/pdf') return { kind: 'pdf' };
  if (type.startsWith('text/') || type === 'application/json') return { kind: 'text' };

  return { kind: 'skip', reason: `nothing to read in a ${file.type || 'file of unknown type'}` };
}

/**
 * Trims a summary to what the column will accept, at a word boundary.
 *
 * The constraint in 011 would reject an over-long one outright, which would
 * lose a whole indexing run to a model in a talkative mood. Cutting mid-word
 * would be worse than either: the result is read by a person and embedded as
 * text, and half a word is noise in both.
 */
export function clampSummary(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_SUMMARY_CHARS) return trimmed;

  const cut = trimmed.slice(0, MAX_SUMMARY_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  // A summary with no space in 500 characters is not prose; take the hard cut.
  return (lastSpace > MAX_SUMMARY_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Normalises what the model called the file.
 *
 * Case and duplicates matter here beyond tidiness: the tags are embedded along
 * with the summary, so "Invoice" and "invoice" in one list is the same word
 * twice, and the vector tilts towards whatever the model repeated.
 */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_TAG_CHARS);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/**
 * A vector as Postgres reads it.
 *
 * pgvector's input format is `[0.1,0.2]` — square brackets, no spaces — which
 * is what JSON.stringify of an array of numbers produces exactly.
 *
 * Measured against production rather than assumed, because the guess written
 * here first was wrong: PostgREST accepts a raw JSON array for a `vector`
 * parameter too, and both spellings return the same row. The literal stays
 * anyway — it is the format the type itself documents, it is the same string
 * on the way in and on the way out, and it does not depend on PostgREST
 * continuing to be clever about a type it knows nothing about.
 */
export function toVectorLiteral(vector: number[]): string {
  return JSON.stringify(vector);
}

/**
 * The text that actually becomes the vector.
 *
 * The file name is included, and first: it is the one piece of the row the
 * user wrote themselves, and `holiday-prague.jpg` carries intent that no
 * description of the pixels will recover. The summary and the tags follow
 * because they are what makes a camera filename findable at all.
 */
export function embeddingInput(file: { name: string }, summary: string, tags: string[]): string {
  const parts = [file.name, summary];
  if (tags.length > 0) parts.push(tags.join(', '));
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}
