/**
 * Cuts every address in a Sentry event at its `?` and its `#`.
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
 * What this does not find is an address inside a sentence. An error whose
 * message quotes one keeps it.
 */

/** An address and nothing else, with or without the method Sentry puts before one. */
const AN_ADDRESS = /^(?:[A-Z]+ )?(?:[a-z][a-z0-9+.-]*:\/\/|\/)\S*$/;

/** Fields that hold a query string or a fragment by themselves. */
const WHAT_WAS_CUT = /(?:^|\.)(?:query|fragment|query_string)$/;

export function withoutQuery(text: string): string {
  if (!AN_ADDRESS.test(text)) return text;

  const end = text.search(/[?#]/);
  return end === -1 ? text : text.slice(0, end);
}

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
      if (typeof value === 'string') node[index] = withoutQuery(value);
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
    else if (typeof value === 'string') node[key] = withoutQuery(value);
    else scrub(value, seen);
  }
}

/**
 * The event, with no address in it longer than its path. It is edited where
 * it stands and handed back, which is the shape Sentry's `beforeSend` wants.
 */
export function withoutSecrets<T>(event: T): T {
  scrub(event, new WeakSet());
  return event;
}
