/**
 * A failed query, as supabase-js hands it over.
 *
 * supabase-js does not throw for a query. It resolves with `error` set to the
 * body PostgREST answered with, parsed (`error = JSON.parse(body)` in
 * postgrest-js 2.116), or, when no answer came at all, to an object it builds
 * with the same four fields. Neither is an Error. Code that asks
 * `instanceof Error` sees "Unknown error" where the database said what was
 * wrong, and Sentry, handed one, files it under "Object captured as exception
 * with keys: code, details, hint, message", whatever it was.
 *
 * A body that was not JSON, a gateway's error page, comes as `{ message }`
 * alone and is not one of these: its message is a page of HTML.
 */
export type PostgrestErrorBody = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
};

export function isPostgrestError(value: unknown): value is PostgrestErrorBody {
  if (typeof value !== 'object' || value === null || value instanceof Error) return false;
  const { message, code } = value as Partial<Record<keyof PostgrestErrorBody, unknown>>;
  return (
    typeof message === 'string' && typeof code === 'string' && 'details' in value && 'hint' in value
  );
}

/** A schema's refusal: an Error whose message is the list of its issues, as JSON. */
function isZodError(value: unknown): value is Error & { issues: { message: string }[] } {
  return (
    value instanceof Error &&
    value.name === 'ZodError' &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

/**
 * What a failure said about itself: an Error's message or the database's, and
 * nothing for anything else. For a schema's refusal, the sentence of its first
 * issue: its message is that list as JSON, and a toast showed it as it was.
 */
export function messageOf(error: unknown): string | undefined {
  if (isZodError(error)) return error.issues[0]?.message ?? error.message;
  if (error instanceof Error || isPostgrestError(error)) return error.message;
  return undefined;
}
