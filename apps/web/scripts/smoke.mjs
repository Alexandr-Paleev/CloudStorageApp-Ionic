#!/usr/bin/env node
/**
 * Starts the built site and asks it what a visitor and a crawler would.
 *
 * `next build` passing says the pages compile. It does not say that the
 * words are in the HTML, and that is the reason this site exists: the app
 * renders in the browser, and a crawler that runs no script sees an empty
 * shell there. So the first question is put with `fetch`, which runs none.
 *
 * The second is put with a browser, because the policy in `next.config.ts`
 * is only enforced by one. A script the policy refuses does not fail a
 * request. It prints to the console, and the page stays half alive.
 *
 * Usage: node scripts/smoke.mjs                       (from apps/web, after `next build`)
 *        node scripts/smoke.mjs <url>                 (against a site that is running)
 *        node scripts/smoke.mjs <url> --production    (against the production deployment)
 *
 * Only the production deployment asks to be indexed, so the two kinds of
 * target are held to opposite answers on that one point.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const PORT = 4123;
const STARTUP_MS = 30_000;

const args = process.argv.slice(2);
const given = args.find((arg) => !arg.startsWith('--'));
const production = args.includes('--production');
const origin = (given ?? `http://localhost:${PORT}`).replace(/\/$/, '');

const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
};

async function waitUntilUp() {
  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(origin, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${origin} did not answer within ${STARTUP_MS / 1000} s`);
}

/** What a client that runs no script is given. */
async function asACrawler() {
  const page = await fetch(`${origin}/`);
  const html = await page.text();

  expect(page.status === 200, `/ answered ${page.status}`);
  expect(/<h1[^>]*>[^<]*files[^<]*<\/h1>/i.test(html), 'the heading is not in the HTML');
  expect(html.includes('Open the app'), 'the link to the app is not in the HTML');
  expect(/<link rel="canonical" href="[^"]+"/.test(html), 'there is no canonical link');
  expect(/<meta property="og:image" content="[^"]+"/.test(html), 'there is no social image');
  expect(/<meta name="description" content="[^"]{50,}"/.test(html), 'there is no description');
  const asksNotToBeIndexed = /<meta name="robots" content="noindex/.test(html);
  expect(
    asksNotToBeIndexed !== production,
    production
      ? 'the production deployment asks not to be indexed'
      : 'a build that is not production asks to be indexed'
  );

  for (const header of [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'strict-transport-security',
  ]) {
    expect(page.headers.has(header), `no ${header} header`);
  }
  expect(!page.headers.has('x-powered-by'), 'the response says what served it');

  const robots = await fetch(`${origin}/robots.txt`);
  expect(robots.status === 200, `/robots.txt answered ${robots.status}`);
  const rules = await robots.text();
  if (production) {
    expect(/Allow: \//.test(rules), 'robots.txt does not let the production deployment be crawled');
    expect(/Sitemap: https:\/\//.test(rules), 'robots.txt names no sitemap');
  } else {
    expect(/Disallow: \//.test(rules), 'robots.txt lets a build that is not production be crawled');
  }

  const sitemap = await fetch(`${origin}/sitemap.xml`);
  expect(sitemap.status === 200, `/sitemap.xml answered ${sitemap.status}`);
  expect((await sitemap.text()).includes('<loc>'), 'the sitemap lists nothing');

  const missing = await fetch(`${origin}/no-such-page`);
  expect(missing.status === 404, `a page that does not exist answered ${missing.status}`);
}

/** What a browser makes of it, the policy included. */
async function asAVisitor() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const complaints = [];
    page.on('console', (message) => {
      if (message.type() === 'error') complaints.push(message.text());
    });
    page.on('pageerror', (error) => complaints.push(String(error)));

    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });

    expect(await page.getByRole('heading', { level: 1 }).isVisible(), 'the heading is not visible');
    const app = page.getByRole('link', { name: 'Open the app' }).first();
    expect(
      /^https?:\/\/[^/]+\/login$/.test((await app.getAttribute('href')) ?? ''),
      'the link to the app does not lead to its login page'
    );
    expect(complaints.length === 0, `the browser complained: ${complaints.join(' | ')}`);
  } finally {
    await browser.close();
  }
}

const server = given
  ? null
  : spawn(
      process.execPath,
      [require.resolve('next/dist/bin/next'), 'start', '--port', String(PORT)],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, NODE_ENV: 'production' },
      }
    );

try {
  await waitUntilUp();
  await asACrawler();
  await asAVisitor();
} catch (error) {
  problems.push(String(error?.message ?? error));
} finally {
  server?.kill();
}

if (problems.length > 0) {
  console.error(`The site at ${origin} is not right:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('The site is in its HTML, sends its headers, and a browser has no complaint.');
