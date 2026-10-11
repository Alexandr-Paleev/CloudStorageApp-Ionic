import { APP_ORIGIN } from './site';

/**
 * What a share link holds, as far as this site is told.
 *
 * The page a share link opens is rendered here, on a server, for whoever
 * asks: a person, or a messenger unfurling the link. So it is made from what
 * `/api/share` says about a link without opening it, which is a name, a size
 * and a type, and it holds no address for the file. The address is asked for
 * from the visitor's browser when they press the button: `open-share.ts`,
 * and decision 0014.
 */

export interface SharedFile {
  name: string;
  size: number;
  type: string;
}

export type Description =
  /** The link opens, and this is what it opens. */
  | { state: 'described'; file: SharedFile }
  /** There is no such link, or the file behind it has been deleted. */
  | { state: 'missing' }
  /** Revoked or expired. The functions say which, in a sentence. */
  | { state: 'ended'; message: string }
  /** Nobody answered: the functions refused, failed, or took too long. */
  | { state: 'unanswered' };

/**
 * How long an answer is kept, and the whole reason one is kept at all.
 *
 * To the functions this site is one address, whoever its visitors are, and
 * `/api/share` allows an address 120 requests a minute. A link passed round
 * an office would spend that on one file. So an answer is reused for a
 * minute, which is also the window that limit is counted in.
 *
 * It is a strict minute. An answer older than that is not shown to anyone:
 * the next visitor waits for a new one. That is the promise the page makes
 * about a link its owner has taken back. It stops downloading at once,
 * because the download is asked for separately and never kept, and it stops
 * being described within the minute.
 */
const KEEP_MS = 60_000;

/**
 * How many answers are kept at once.
 *
 * A caller walking made-up tokens gets an answer for each, and every one of
 * them would otherwise stay here. Past this many the oldest goes.
 */
const KEEP_AT_MOST = 500;

/** Then the page is rendered without a description, and still downloads. */
const WAIT_MS = 5_000;

/**
 * The app writes a name of at most 255 characters. The row is written by a
 * browser all the same, so a longer one can be stored, and this page would
 * print it three times and keep it for a minute. It is cut here.
 */
const LONGEST_TEXT = 255;

/**
 * Whether this could be a token at all.
 *
 * A token is 32 random bytes in base64url: 43 characters. The site is not
 * held to that number. It cannot import the function that makes one, and
 * should not start refusing links on the day that function changes. It
 * refuses what no token could be, other characters or a great many of them,
 * and answers those itself without asking anyone.
 */
const COULD_BE_A_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

const UNANSWERED: Description = { state: 'unanswered' };
const MISSING: Description = { state: 'missing' };

interface Kept {
  at: number;
  answer: Promise<Description>;
}

/* In the memory of one instance, as the functions' own limits are (decision
   0007): a second instance asks for itself. A Map keeps the order things
   were put in, so the first key is the oldest. */
const kept = new Map<string, Kept>();

/** Forgets every answer. For tests, and harmless anywhere else. */
export function forgetDescriptions(): void {
  kept.clear();
}

function clip(text: string): string {
  return text.length > LONGEST_TEXT ? `${text.slice(0, LONGEST_TEXT - 1)}…` : text;
}

function readFile(body: unknown): SharedFile | null {
  if (typeof body !== 'object' || body === null) return null;
  const { name, size, type } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name === '') return null;

  return {
    name: clip(name),
    size: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0,
    type: typeof type === 'string' ? clip(type) : '',
  };
}

async function ask(token: string): Promise<Description> {
  let response: Response;
  try {
    response = await fetch(`${APP_ORIGIN}/api/share?token=${encodeURIComponent(token)}&describe`, {
      /* Next has a cache of its own for `fetch`, and it stays out of this.
         It keeps an answer of 200 and no other, and goes on serving the one
         it has until a newer 200 replaces it. A revoked link answers 410,
         so nothing ever does. Tried on Next 16.4 with a life of two
         seconds: thirty seconds after the link was revoked the page still
         named the file, on every visit. */
      cache: 'no-store',
      signal: AbortSignal.timeout(WAIT_MS),
    });
  } catch {
    return UNANSWERED;
  }

  if (response.status === 404) return MISSING;

  const body: unknown = await response.json().catch(() => null);

  if (response.status === 410) {
    const message = (body as { message?: unknown } | null)?.message;
    return {
      state: 'ended',
      message: typeof message === 'string' && message ? clip(message) : 'This link no longer opens',
    };
  }

  if (!response.ok) return UNANSWERED;

  const file = readFile(body);
  return file ? { state: 'described', file } : UNANSWERED;
}

/**
 * Says what a link holds, asking the functions at most once a minute for
 * each link.
 *
 * Two callers in one render ask for the same link, the page and its
 * metadata, and they are given one request: what is kept is the answer
 * still on its way, not the answer once it has arrived.
 *
 * An answer that is no answer is not kept. The next visitor asks again.
 */
export function describeLink(token: string): Promise<Description> {
  if (!COULD_BE_A_TOKEN.test(token)) return Promise.resolve(MISSING);

  const now = Date.now();
  const had = kept.get(token);
  if (had && now - had.at < KEEP_MS) return had.answer;

  const answer = ask(token);

  /* Taken out before it is put back, so that a link asked about again goes
     to the end of the line and not back to the place it had. */
  kept.delete(token);
  kept.set(token, { at: now, answer });

  if (kept.size > KEEP_AT_MOST) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }

  void answer.then((description) => {
    if (description.state === 'unanswered' && kept.get(token)?.answer === answer) {
      kept.delete(token);
    }
  });

  return answer;
}
