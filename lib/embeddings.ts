import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, ProviderNotConfigured } from './ai';

/**
 * Text in, one vector out.
 *
 * Voyage publishes no TypeScript SDK, so this is the HTTP API directly — the
 * request is three fields and the response is one array, and a hand-rolled
 * client here is less code than the adapter around a Python-first one would
 * be.
 *
 * Deliberately not retried. This runs inside a serverless function that the
 * browser is waiting on, and a retry loop here turns one slow request into
 * three before anyone is told anything; the caller retries a failed search by
 * typing it again, and a failed index is picked up by the backfill.
 */

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/** Long enough for a cold request, short enough to answer inside a function. */
const TIMEOUT_MS = 20_000;

/**
 * Which side of the search the text is on.
 *
 * Not cosmetic: Voyage prepends a different instruction to each — "represent
 * the document for retrieval" against "represent the query for retrieving
 * supporting documents" — and the two sides of a search have to be embedded
 * with the matching one or the vectors are answering different questions.
 */
export type InputType = 'document' | 'query';

export async function embed(text: string, inputType: InputType): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new ProviderNotConfigured('VOYAGE_API_KEY is not configured on the server');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Truncated: the body of an error from an upstream API is not always short
    // and ends up in a log and in a message to the client.
    const body = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Voyage answered ${response.status}${body ? `: ${body}` : ''}`);
  }

  const payload = (await response.json()) as { data?: { embedding?: unknown }[] };
  const vector = payload.data?.[0]?.embedding;

  if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number')) {
    throw new Error('Voyage returned no embedding');
  }

  /* The dimension is checked rather than requested. The column in
     migrations/011 is vector(1024) and a row of any other width is rejected by
     Postgres with a message about the type — this says the useful thing
     instead, and it is the check that catches a model swapped in the constant
     without the migration that has to come with it. */
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${EMBEDDING_MODEL} returned ${vector.length} dimensions, ` +
        `and public.file_embeddings.embedding holds ${EMBEDDING_DIMENSIONS}`
    );
  }

  return vector as number[];
}
