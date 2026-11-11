import { randomUUID } from 'node:crypto';

/**
 * What goes wrong in a function, sent to Sentry.
 *
 * The functions wrote their failures to the console and nowhere else, and
 * Vercel keeps a Hobby project's runtime logs for an hour. A webhook that
 * failed at night, an erase that left a bucket behind, a model that refused:
 * each was in a log nobody would read before it was gone. `account-erase.ts`
 * said what could not be reached was "reported so it can be swept later", and
 * it was reported to that log.
 *
 * No SDK. Sentry's Node SDK brings OpenTelemetry with it, and every function
 * would load that on a cold start to send what is one POST. This is the POST,
 * in the envelope format Sentry documents, and it is sent only where a DSN is
 * configured: `SENTRY_DSN`, or on Vercel the browser's `VITE_SENTRY_DSN`, which
 * is public by design and the same project.
 *
 * What it sends follows decision 0015, as the browser's reports do: an
 * address loses its query string and fragment, where a signed URL keeps its
 * token, and a stored path loses the file's name after the owner's id. The
 * account is named by its id, never by its email.
 */

export interface ReportContext {
  /** The function and the action, as `stripe/webhook` or `ai/index`. */
  route: string;
  /** The account the request was for, when the failure knows it. */
  userId?: string;
  level?: 'error' | 'warning';
  extra?: Record<string, string | number | boolean>;
}

/** Long enough for a cold connection, short enough not to hold an error
 *  response for anyone. */
const TIMEOUT_MS = 2_000;

const MAX_MESSAGE = 1_000;
const MAX_STACK = 4_000;

const OWNER = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** An address in running text, up to its `?` or `#`, and what follows them. */
const ADDRESS_TAIL = /(https?:\/\/[^\s?#'"<>]*)[?#][^\s'"<>]*/gi;

/**
 * What follows an owner's id and a slash: a stored file's name. To the end of
 * the line or the closing quote, not to the next space, because a name can
 * have spaces in it, and whatever the message said after the path goes too.
 * The time it was uploaded stays, as the browser keeps it
 * (src/observability/scrub.ts): with the owner's id it says which object it
 * was, for whoever has to find it by hand.
 */
const STORED_NAME = new RegExp(`(${OWNER}/)(\\d+_)?[^'"<>\\n]+`, 'gi');

/** The text, with what decision 0015 keeps from a collector taken out. */
export function scrubbed(text: string): string {
  return text.replace(ADDRESS_TAIL, '$1').replace(STORED_NAME, '$1$2…');
}

interface Dsn {
  /** The envelope endpoint of the project. */
  endpoint: string;
  publicKey: string;
  dsn: string;
}

/** `https://<key>@<host>[/<path>]/<project>` read as the endpoint it names. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;

  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project) return null;

  const path = segments.map((segment) => `/${segment}`).join('');
  return {
    endpoint: `${url.protocol}//${url.host}${path}/api/${project}/envelope/`,
    publicKey: url.username,
    dsn,
  };
}

/**
 * What a failure says about itself. Not every failure is an Error: supabase-js
 * resolves with a body that has a message, and Cloudinary's admin API, which
 * the erase uses, rejects with its answer, which keeps the message under
 * `error`. Nothing else of such an object is read. Cloudinary's also holds the
 * request it made, with the key and the secret in it unless `hide_sensitive`
 * is set (erase-providers.ts sets it).
 */
function messageOf(error: unknown): string {
  const body = error as { message?: unknown; error?: { message?: unknown } } | null | undefined;
  const message = body?.message ?? body?.error?.message;
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return typeof error === 'object' && error !== null ? 'A failure with no message' : String(error);
}

/** A failure as Sentry's exception wants it: a type and a sentence. */
function asException(error: unknown): { type: string; value: string; stack?: string } {
  const value = messageOf(error);
  if (!(error instanceof Error)) return { type: 'Error', value };
  return {
    type: error.name || 'Error',
    value,
    stack: typeof error.stack === 'string' ? error.stack : undefined,
  };
}

/**
 * `SENTRY_DSN`, or on Vercel the browser's, which is the same project. Off
 * Vercel only the first: `npm run dev` serves these functions with the whole
 * `.env` loaded (vite-plugin-dev-api.mts), the end-to-end suite runs on it,
 * and the browser's DSN in a developer's `.env` made a local run's failures
 * events in the real project. `VERCEL` is set on every deployment.
 */
function dsnToSendTo(): string | undefined {
  if (process.env.SENTRY_DSN) return process.env.SENTRY_DSN;
  return process.env.VERCEL ? process.env.VITE_SENTRY_DSN : undefined;
}

/**
 * Sends one failure, and never throws: a report that cannot be sent must not
 * become the failure the caller answers with. Awaited by the caller, because
 * work left running after a function has answered may never finish.
 */
export async function report(error: unknown, context: ReportContext): Promise<void> {
  /* The tests take routes to their failures on purpose, and a developer's
     .env holds the browser's DSN: run there, every one of them would become
     an event in the real project. */
  if (process.env.VITEST) return;

  const dsn = parseDsn(dsnToSendTo());
  if (!dsn) return;

  /* All of it, not only the POST: a failure that cannot be read, such as one
     whose getter throws, must not become the failure either. The erase awaits
     this between providers, and a throw here would stop it halfway. */
  try {
    const { type, value, stack } = asException(error);
    const eventId = randomUUID().replace(/-/g, '');

    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: context.level ?? 'error',
      logger: 'api',
      environment: process.env.VERCEL_ENV ?? 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      transaction: context.route,
      tags: { route: context.route },
      ...(context.userId && { user: { id: context.userId } }),
      exception: { values: [{ type, value: scrubbed(value).slice(0, MAX_MESSAGE) }] },
      extra: {
        ...context.extra,
        ...(stack && { stack: scrubbed(stack).slice(0, MAX_STACK) }),
      },
    };

    const envelope = [
      JSON.stringify({ event_id: eventId, dsn: dsn.dsn, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');

    await fetch(dsn.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=cloud-storage-api/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* Neither a failure this cannot read nor Sentry unreachable is something
       the caller can act on. */
  }
}
