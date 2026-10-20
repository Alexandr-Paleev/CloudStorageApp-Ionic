/**
 * Cuts every address in a Sentry event at its `?` and its `#`, and a stored
 * file's name out of it.
 *
 * An event carries addresses in more places than anyone lists from memory.
 * Taken from this app's own events: the address of the page, the same again
 * inside the trace, a span described by it, the two ends of every navigation
 * in the breadcrumbs, and the address of each request the page made. Some of
 * those addresses are credentials for as long as they stand. A sign-in comes
 * back with its tokens after the `#`, an OAuth callback with its code after
 * the `?`, and an upload goes to an address signed in its query string.
 *
 * So nothing is listed. Every string in the event that is an address is cut,
 * wherever it sits, and what the event loses is the part after the `?` on
 * requests whose query would sometimes have helped to read. Decision 0015.
 *
 * A stored file's name is cut out the same way. Its path begins with its
 * owner's id (`ownerPrefix` in libs/core/src/stored-path.ts, and migrations/013
 * holds every row to that), and what follows the id is the time it was
 * uploaded and its name, as the upload routes write it. So in an address, and
 * in a field that holds such a path by itself, everything after the owner's
 * id goes but that time: a request to Supabase Storage or R2 reads
 * `…/<owner>/1760950000000_[name]`, which still says which object it was.
 *
 * What this does not find is an address or a path inside a sentence. An
 * error whose message quotes one keeps it, so no message here is written
 * with a file's name or path in it.
 */

/** An address and nothing else, with or without the method Sentry puts before one. */
const AN_ADDRESS = /^(?:[A-Z]+ )?(?:[a-z][a-z0-9+.-]*:\/\/|\/)\S*$/;

/** Fields that hold a query string or a fragment by themselves. */
const WHAT_WAS_CUT = /(?:^|\.)(?:query|fragment|query_string)$/;

const OWNER = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A stored path by itself: `<owner>/…` in Supabase Storage, `users/<owner>/…` elsewhere. */
const A_STORED_PATH = new RegExp(`^(?:users/)?${OWNER}/`, 'i');

/** An owner's id as a whole segment of a path. */
const AN_OWNER = new RegExp(`(?:^|/)${OWNER}/`, 'i');

export function withoutQuery(text: string): string {
  if (!AN_ADDRESS.test(text)) return text;

  const end = text.search(/[?#]/);
  return end === -1 ? text : text.slice(0, end);
}

/** The text, with a stored file's name cut out of it if it is an address or a stored path. */
export function withoutName(text: string): string {
  if (!AN_ADDRESS.test(text) && !A_STORED_PATH.test(text)) return text;

  const owner = AN_OWNER.exec(text);
  if (!owner) return text;

  const end = owner.index + owner[0].length;
  if (end === text.length) return text;

  const uploaded = /^\d+_/.exec(text.slice(end))?.[0] ?? '';
  return `${text.slice(0, end)}${uploaded}[name]`;
}

/** Both cuts, in the order an address needs them: its query first, then the name in its path. */
const cut = (text: string): string => withoutName(withoutQuery(text));

function isPlain(node: unknown): node is Record<string, unknown> {
  if (typeof node !== 'object' || node === null) return false;
  const prototype: unknown = Object.getPrototypeOf(node);
  return prototype === Object.prototype || prototype === null;
}

function scrub(node: unknown, seen: WeakSet<object>): void {
  if (Array.isArray(node)) {
    if (seen.has(node)) return;
    seen.add(node);

    node.forEach((value, index) => {
      if (typeof value === 'string') node[index] = cut(value);
      else scrub(value, seen);
    });
    return;
  }

  /* Plain objects only. An event also carries things that are not data, a
     scope or a span among them, and those are not this function's to edit. */
  if (!isPlain(node) || seen.has(node)) return;
  seen.add(node);

  for (const [key, value] of Object.entries(node)) {
    if (WHAT_WAS_CUT.test(key)) delete node[key];
    else if (typeof value === 'string') node[key] = cut(value);
    else scrub(value, seen);
  }
}

/**
 * The event, with no address in it longer than its path and no stored file's
 * name. It is edited where it stands and handed back, which is the shape
 * Sentry's `beforeSend` wants.
 */
export function withoutSecrets<T>(event: T): T {
  scrub(event, new WeakSet());
  return event;
}
