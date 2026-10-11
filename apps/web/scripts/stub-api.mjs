#!/usr/bin/env node
/**
 * A stand-in for the app's `/api/share`, for the page a share link opens.
 *
 * The real one answers a browser on one origin, the production site's. A
 * site running on a laptop or in CI is another origin and is not answered,
 * so the page cannot be tried against the real functions from there. It is
 * tried against this, by a site built to take this for the app:
 *
 *   NEXT_PUBLIC_APP_ORIGIN=http://localhost:4124
 *
 * The smoke test does both for itself. To look at the page by hand, start
 * this, run `next dev` with that variable, and open one of the addresses it
 * prints.
 *
 * What it answers is copied from `api/share.ts`: the same statuses, the same
 * sentences, the same three fields and the fourth. It is a copy, and nothing
 * holds it to the original but the reader of both. The end-to-end suite of
 * the app is where the real answers are checked.
 *
 * Usage: node scripts/stub-api.mjs [the site's origin, http://localhost:3000 if none]
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const STUB_PORT = 4124;
export const STUB_ORIGIN = `http://localhost:${STUB_PORT}`;

/** A token of the real length, 43 characters, that says which link it is. */
const named = (name) => name.padEnd(43, '_');

export const TOKENS = {
  /** Opens. */
  live: named('a-link-that-opens'),
  /** Opens, and holds a file whose name and type have nowhere to break. */
  long: named('a-file-with-a-long-name'),
  revoked: named('a-revoked-link'),
  expired: named('an-expired-link'),
  /** The functions will not describe it, and will open it. */
  unnamed: named('a-link-nobody-describes'),
  /** Opens with an address no browser should be sent to. */
  unsafe: named('a-file-stored-as-a-script'),
  /** Is described, and fails when it is opened. */
  broken: named('a-link-that-fails-to-open'),
  /** Opens until `revoke` is called on it. */
  takenBack: named('a-link-about-to-be-revoked'),
  /** Was never issued. Any token not in this list is the same. */
  missing: named('a-link-nobody-made'),
};

const REPORT = { name: 'report.pdf', size: 1_258_291, type: 'application/pdf' };

const LONG = {
  name: 'quarterly-figures-and-the-notes-that-go-with-them_second-revision_approved-by-everyone.xlsx',
  size: 48_211,
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const REVOKED = 'This link has been revoked';

/** What the address of the `unsafe` link writes on a window it is run in. */
export const RAN = 'a script ran';

function links() {
  return new Map([
    [TOKENS.live, { file: REPORT }],
    [TOKENS.long, { file: LONG }],
    [TOKENS.revoked, { ended: REVOKED }],
    [TOKENS.expired, { ended: 'This link has expired' }],
    [
      TOKENS.unnamed,
      { file: REPORT, describing: [429, 'Too many requests. Try again in a minute.'] },
    ],
    /* The real functions refuse to hand this out. This hands it out, so
       that what refuses it is the page. `void`, because a script address
       that comes to a value replaces the page with that value, and the
       mark it was to leave goes with the page. */
    [TOKENS.unsafe, { file: REPORT, address: `javascript:void(window.name='${RAN}')` }],
    [TOKENS.broken, { file: REPORT, opening: [500, 'Internal server error'] }],
    [TOKENS.takenBack, { file: REPORT }],
  ]);
}

/**
 * Starts the stand-in.
 *
 * `siteOrigin` is the one origin a browser is answered on, as the real
 * functions name one. `asked` says how often a link was described and how
 * often it was opened, which is how a test learns that rendering a page
 * signed nothing.
 */
export async function startStubApi({ port = STUB_PORT, siteOrigin }) {
  const origin = `http://localhost:${port}`;
  const table = links();
  const counts = new Map();
  let total = 0;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', origin);

    if (url.pathname.startsWith('/files/')) {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('The file a share link opens.\n');
      return;
    }

    const answer = (status, body, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(JSON.stringify(body));
    };

    response.setHeader('Vary', 'Origin');
    if (request.headers.origin === siteOrigin) {
      response.setHeader('Access-Control-Allow-Origin', siteOrigin);
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }

    if (url.pathname !== '/api/share') return answer(404, { message: 'Not found' });
    if (request.method === 'OPTIONS') return response.writeHead(204).end();
    if (request.method !== 'GET') return answer(405, { message: 'Method not allowed' });

    const token = url.searchParams.get('token') ?? '';
    const describing = url.searchParams.has('describe');
    if (!token) return answer(400, { message: 'token is required' });

    total += 1;
    const count = counts.get(token) ?? { described: 0, opened: 0 };
    count[describing ? 'described' : 'opened'] += 1;
    counts.set(token, count);

    const link = table.get(token);
    if (!link) return answer(404, { message: 'This link does not exist' });
    if (link.ended) return answer(410, { message: link.ended });

    const refusal = describing ? link.describing : link.opening;
    if (refusal) {
      const [status, message] = refusal;
      return answer(status, { message }, status === 429 ? { 'Retry-After': '30' } : {});
    }

    if (describing) return answer(200, link.file);

    return answer(200, {
      ...link.file,
      downloadUrl: link.address ?? `${origin}/files/${encodeURIComponent(link.file.name)}`,
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });

  return {
    origin,
    asked: (token) => ({ described: 0, opened: 0, ...counts.get(token) }),
    /** Every question about a link, whichever link. */
    total: () => total,
    /** What an owner does to a link that got out. */
    revoke: (token) => table.set(token, { ended: REVOKED }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const siteOrigin = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
  const { origin } = await startStubApi({ siteOrigin });

  console.log(`Standing in for the app's functions at ${origin}, for a site at ${siteOrigin}.`);
  console.log(`Start that site with NEXT_PUBLIC_APP_ORIGIN=${origin}, and open:\n`);
  for (const [name, token] of Object.entries(TOKENS)) {
    console.log(`  ${name.padEnd(10)} ${siteOrigin}/s/${token}`);
  }
}
