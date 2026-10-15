/**
 * Starts the built app at addresses that carry a secret, and asks who was
 * told.
 *
 * Some of this app's addresses are credentials for as long as they stand: a
 * sign-in comes back with its tokens after the `#`, and an OAuth callback
 * carries its code after the `?`. Three collectors run in the app, and each
 * of them reports addresses. Until decision 0015 the code reached Google
 * Analytics as the path of a page view, and the tokens reached Sentry in
 * four fields of one event.
 *
 * Every secret here is made up, by this file, each time it runs. Nothing is
 * delivered either: every request that leaves the app's origin is caught,
 * read and refused. The one exception is the collectors' own scripts, which
 * are let through so that their code runs and what it would send can be
 * read. The sign-in is answered here, in place of Supabase.
 *
 * Two things are asked.
 *
 * That Google Analytics and Hotjar are not started while the address carries
 * anything. Both read the address for themselves, so the request for their
 * script is the evidence. The sign-in is accepted after three seconds, which
 * is when the app removes the tokens, and neither may be asked for sooner.
 *
 * And that nobody is sent a made-up value. Sentry is started at any address
 * and cleans what it sends, so this is the question for Sentry. It samples
 * its traces, which is why the address it used to leak from is opened
 * several times: one session may send nothing. Its cleaning is held by unit
 * tests, and this is the look at the real thing.
 *
 * A build with no collectors configured has nothing to ask, and says so. CI
 * is such a build.
 */
import { randomUUID } from 'node:crypto';

/** How long the made-up sign-in takes to be accepted. */
const ACCEPTED_AFTER_MS = 3000;

/**
 * How long a visit is watched once its page has loaded. Long enough for
 * Sentry, which loads when the browser is idle and then waits for a trace to
 * end.
 */
const WATCH_MS = 12_000;

/**
 * How long a page gets to load before the watch starts anyway.
 *
 * The collectors start once the page has loaded and the browser is idle
 * (src/utils/when-loaded.ts), so the watch starts at the load event. It used
 * to start at the first byte. On 2026-10-15, against production over a slow
 * VPN, seven visits at once did not reach the load event in twelve seconds:
 * one run reported that the app never tried its sign-in, and the next that
 * the build started no collectors at all, which passed. Production has two.
 */
const LOAD_TIMEOUT_MS = 60_000;

/** How many times the address Sentry leaked from is opened. */
const SESSIONS_FOR_A_SAMPLED_TRACE = 4;

/** The two that read the address for themselves, by the names their hosts end in. */
const READS_THE_ADDRESS = [
  'googletagmanager.com',
  'google-analytics.com',
  'hotjar.com',
  'hotjar.io',
];

const readsTheAddress = (host) =>
  READS_THE_ADDRESS.some((name) => host === name || host.endsWith(`.${name}`));

/**
 * Their scripts, which are let through: the host, compared whole, and the
 * path it serves a script at.
 *
 * It was a pattern looked for anywhere in the address, and an address can
 * carry any host's name in its path or its query string. In a file that is
 * about who is sent what, that was the wrong way to tell a host. CodeQL said
 * so on the pull request that added it.
 */
const SERVES_A_COLLECTORS_SCRIPT = new Map([
  ['www.googletagmanager.com', (path) => path === '/gtag/js'],
  ['static.hotjar.com', () => true],
  ['script.hotjar.com', () => true],
]);

const isACollectorsScript = (url) =>
  SERVES_A_COLLECTORS_SCRIPT.get(url.hostname)?.(url.pathname) ?? false;

const isSentry = (host) => host === 'sentry.io' || host.endsWith('.sentry.io');

const made = () => `made-up-${randomUUID()}`;
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** One visit, from a browser that has never seen the app. */
async function visit(browser, origin, address, secrets, signIn) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const opened = Date.now();
  const asked = [];
  let supabase = null;
  let acceptedAt = null;

  await context.route(
    (url) => url.origin !== origin,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      /* The one request a returning sign-in makes before anything else: is
         this token a user's? It is answered here. */
      if (url.pathname.endsWith('/auth/v1/user')) {
        supabase = url.origin;
        if (signIn !== 'accepted') {
          return route.fulfill({ status: 401, json: { message: 'invalid JWT' } });
        }
        await new Promise((resolve) => setTimeout(resolve, ACCEPTED_AFTER_MS));
        acceptedAt = Date.now() - opened;
        return route.fulfill({
          status: 200,
          headers: { 'access-control-allow-origin': '*' },
          json: {
            id: '00000000-0000-4000-8000-000000000000',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'made-up@example.com',
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        });
      }

      const everything = `${decoded(url.href)}\n${request.postData() ?? ''}`;
      asked.push({
        at: Date.now() - opened,
        host: url.hostname,
        origin: url.origin,
        carried: Object.entries(secrets)
          .filter(([, value]) => everything.includes(value))
          .map(([name]) => name),
      });

      return isACollectorsScript(url) ? route.continue() : route.abort();
    }
  );

  try {
    const page = await context.newPage();
    await page.goto(origin + address, { waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForTimeout(WATCH_MS);
  } finally {
    await context.close();
  }

  /* The tokens are Supabase's own, and it is sent them in the ordinary
     course of signing in. Everybody else is the question. */
  return { asked: asked.filter((request) => request.origin !== supabase), acceptedAt };
}

const readers = (asked) => asked.filter((request) => readsTheAddress(request.host));

/**
 * @returns {Promise<{ configured: boolean, problems: string[], said: string }>}
 */
export async function askTheCollectors(browser, target) {
  const origin = new URL(target).origin;

  const jwt = `${base64({ alg: 'HS256', typ: 'JWT' })}.${base64({
    sub: '00000000-0000-4000-8000-000000000000',
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.${made()}`;
  const notAToken = made();
  const refresh = made();
  const code = made();

  const returning = (access) =>
    `/dashboard#access_token=${access}&expires_in=3600&refresh_token=${refresh}&token_type=bearer&type=signup`;
  const secrets = {
    'a sign-in’s access token': jwt.split('.')[2],
    'a sign-in’s access token (one that is not a token)': notAToken,
    'a sign-in’s refresh token': refresh,
    'an OAuth code': code,
  };

  const [bare, signIn, callback, ...refused] = await Promise.all([
    visit(browser, origin, '/login', secrets, 'none'),
    visit(browser, origin, returning(jwt), secrets, 'accepted'),
    visit(browser, origin, `/auth/dropbox/callback?code=${code}&state=x`, secrets, 'none'),
    ...Array.from({ length: SESSIONS_FOR_A_SAMPLED_TRACE }, () =>
      visit(browser, origin, returning(notAToken), secrets, 'refused')
    ),
  ]);

  /* The control. If nothing asks for a collector on the plainest address
     there is, this build has none, and the rest would pass by saying
     nothing. */
  if (readers(bare.asked).length === 0) {
    return {
      configured: false,
      problems: [],
      said: 'this build starts no collectors, so there was nobody to ask',
    };
  }

  const problems = [];

  const first = readers(signIn.asked)[0];
  if (signIn.acceptedAt === null) {
    problems.push(
      'The app did not try the sign-in it was handed, so nothing was learned about what happens around one.'
    );
  } else if (!first) {
    problems.push(
      'Google Analytics and Hotjar were never started after a sign-in, though the address had become a path again.'
    );
  } else if (first.at < signIn.acceptedAt) {
    problems.push(
      `${first.host} was asked for ${first.at} ms after the app opened, while a sign-in’s tokens were still in the address. ` +
        `They stayed there until ${signIn.acceptedAt} ms. In src/analytics/collectors.ts, the two collectors that read the address ` +
        'are not started until it has no query string and no fragment.'
    );
  }

  for (const [where, visited] of [
    ['a sign-in coming back', signIn],
    ['an OAuth callback', callback],
    ...refused.map((visited) => ['a sign-in that is refused', visited]),
  ]) {
    for (const request of visited.asked.filter(({ carried }) => carried.length > 0)) {
      problems.push(`At ${where}, ${request.host} was sent ${request.carried.join(' and ')}.`);
    }
  }

  const sentry = refused.flatMap(({ asked }) => asked).filter(({ host }) => isSentry(host));
  const when =
    `first asked for at ${first?.at ?? '?'} ms, with a sign-in’s tokens in the address ` +
    `until ${signIn.acceptedAt ?? '?'} ms`;

  if (problems.length > 0) {
    return { configured: true, problems: [...new Set(problems)], said: when };
  }

  return {
    configured: true,
    problems,
    said:
      `held back until the address was a path again (${when}), and sent nothing made up` +
      (sentry.length > 0
        ? `; Sentry sent ${sentry.length} event${sentry.length === 1 ? '' : 's'} from an address with tokens in it, and none carried one`
        : '; Sentry sent nothing from the address with tokens in it this time, so it was not seen'),
  };
}
