#!/usr/bin/env node
/**
 * Builds the site, starts it, and asks it what a visitor and a crawler would.
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
 * The browser is also where each page is put through axe. Two of these pages
 * were static files of the app once, and Lighthouse held them to a score for
 * accessibility there. Nothing audits this site with Lighthouse, so the
 * question is asked here.
 *
 * One page needs somebody to talk to. The page a share link opens asks the
 * app's functions what the link holds, and its button asks them for the
 * file. The real functions answer a browser on the production site's origin
 * and on no other, so here they are a stand-in, `stub-api.mjs`, and the site
 * is built to take that stand-in for the app. That is why this builds the
 * site for itself, and it leaves that build behind in `.next`: one that
 * sends people to the stand-in. `npm run build` makes the real one again.
 *
 * Usage: node scripts/smoke.mjs                       (from apps/web: builds, starts, asks)
 *        node scripts/smoke.mjs <url>                 (against a site that is running)
 *        node scripts/smoke.mjs <url> --production    (against the production deployment)
 *
 * Only the production deployment asks to be indexed, so the two kinds of
 * target are held to opposite answers on that one point. A site that is
 * already running has no stand-in behind it, and its share page is asked
 * only what can be asked without one: `smoke-share.mjs` says what that is.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sharePageAsACrawler,
  sharePageAsAVisitor,
  sharePageOfARunningSite,
} from './smoke-share.mjs';
import { STUB_ORIGIN, startStubApi } from './stub-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const next = require.resolve('next/dist/bin/next');
const PORT = 4123;
const STARTUP_MS = 30_000;

const args = process.argv.slice(2);
const given = args.find((arg) => !arg.startsWith('--'));
const production = args.includes('--production');
const origin = (given ?? `http://localhost:${PORT}`).replace(/\/$/, '');

/** Every page that is the same for everyone. The share page is asked apart. */
const PAGES = ['/', '/pricing', '/privacy', '/terms'];

/** WCAG 2.1 A and AA: what the app's own pages are held to in e2e/a11y.spec.ts. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
};

/** The site, built to take the stand-in for the app. */
function build() {
  const built = spawnSync(process.execPath, [next, 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NEXT_PUBLIC_APP_ORIGIN: STUB_ORIGIN },
  });
  if (built.status !== 0) {
    throw new Error(`the site did not build:\n${built.stdout}\n${built.stderr}`);
  }
}

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

/**
 * What a client that runs no script is given.
 *
 * Returns the address the site sends people to for the app. The share page
 * is held to it: that is the one origin its policy may name.
 */
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

  /* This site's policy names no origin but its own, on every page but the
     one a share link opens. The app's names eleven, and the file that
     carries it has reached this site once: the first deployment was built
     with the `vercel.json` at the root of the repository, which is the
     app's. */
  const policy = page.headers.get('content-security-policy') ?? '';
  expect(
    !/https?:/.test(policy),
    `the policy names another origin, so it is not this site's: ${policy}`
  );
  expect(policy.includes("frame-ancestors 'none'"), 'the policy is not the one in next.config.ts');

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
  const listed = await sitemap.text();
  expect(listed.includes('<loc>'), 'the sitemap lists nothing');
  expect(/<loc>[^<]+\/pricing<\/loc>/.test(listed), 'the sitemap does not list the plans');
  /* A share link is a credential. The site lists none, and could not: it
     does not know one until it is asked about it. */
  expect(!/<loc>[^<]+\/s\//.test(listed), 'the sitemap lists a share link');

  /* The plans. No price is written in this file: the page reads it from
     libs/core, and a figure typed here would be a second copy of it. What is
     asked is that both plans are in the HTML, each with a price and with the
     storage it promises. */
  expect(html.includes('href="/pricing"'), 'the first page does not lead to the plans');
  const pricing = await fetch(`${origin}/pricing`);
  const plans = await pricing.text();
  expect(pricing.status === 200, `/pricing answered ${pricing.status}`);
  expect(
    /<h3[^>]*>Free<\/h3>/.test(plans) && /<h3[^>]*>Pro<\/h3>/.test(plans),
    'the two plans are not in the HTML'
  );
  expect(
    (plans.match(/\$\d+(?:\.\d\d)?</g) ?? []).length >= 2,
    'the plans have no prices in the HTML'
  );
  expect(
    (plans.match(/\d+ (?:MB|GB) storage/g) ?? []).length >= 2,
    'the plans do not say what they hold'
  );
  expect(
    /<link rel="canonical" href="[^"]+\/pricing"/.test(plans),
    'the plans page has no canonical link of its own'
  );

  /* The legal documents. They are written as markdown and read by a small
     reader of this site's own, so what is asked is that each arrived as a
     document: one title, its sections, and none of the punctuation it was
     written in. */
  for (const [path, title] of [
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
  ]) {
    const response = await fetch(`${origin}${path}`);
    const document = await response.text();
    const article = document.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? '';

    expect(response.status === 200, `${path} answered ${response.status}`);
    expect(
      (article.match(/<h1[\s>]/g) ?? []).length === 1,
      `${path} does not have exactly one title`
    );
    expect(article.includes(title), `${path} is not the ${title}`);
    expect((article.match(/<h2[\s>]/g) ?? []).length >= 5, `${path} has lost its sections`);
    expect(!/\*\*|\]\(|^#{1,6}\s/m.test(article), `${path} shows markdown punctuation`);
    /* The documents link to each other by file name, which is right where
       they are files. On a page it has to have become the other page. */
    expect(!/href="[^"]*\.md"/.test(article), `${path} links to a markdown file`);
    expect(
      new RegExp(`<link rel="canonical" href="[^"]+${path}"`).test(document),
      `${path} has no canonical link of its own`
    );
    expect(new RegExp(`<loc>[^<]+${path}</loc>`).test(listed), `the sitemap does not list ${path}`);
    expect(html.includes(`href="${path}"`), `the first page does not lead to ${path}`);
  }

  const missing = await fetch(`${origin}/no-such-page`);
  expect(missing.status === 404, `a page that does not exist answered ${missing.status}`);

  const appOrigin = html.match(/href="(https?:\/\/[^/"]+)\/login"/)?.[1] ?? '';
  expect(appOrigin !== '', 'the first page does not say where the app is');
  return appOrigin;
}

/** What a browser makes of it, the policy included. */
async function asAVisitor(stub) {
  const { chromium } = require('playwright');
  const { AxeBuilder } = require('@axe-core/playwright');
  const browser = await chromium.launch();

  /* A header that does not fit pushes the whole page sideways, and it only
     does so on a phone. It did once, at 320 pixels, when a link was added. */
  const audit = async (page, path) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow === 0, `${path} is ${overflow}px wider than a ${width}px screen`);
    }

    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      violations.length === 0,
      `${path} breaks accessibility rules: ` +
        violations.map(({ id, nodes }) => `${id} (${nodes.length})`).join(', ')
    );
  };

  try {
    /* A context of its own, which axe asks for. */
    const context = await browser.newContext();
    const page = await context.newPage();
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
    await page.goto(`${origin}/pricing`, { waitUntil: 'networkidle' });
    expect(
      await page.getByRole('heading', { level: 1 }).isVisible(),
      'the plans page has no visible heading'
    );

    for (const path of PAGES) await audit(page, path);

    /* Asked last, so that it is asked of every page above. */
    expect(complaints.length === 0, `the browser complained: ${complaints.join(' | ')}`);
    await context.close();

    if (stub) await sharePageAsAVisitor({ browser, origin, stub, expect, audit });
  } finally {
    await browser.close();
  }
}

let server = null;
let stub = null;

try {
  if (!given) {
    build();
    stub = await startStubApi({ siteOrigin: origin });
    server = spawn(process.execPath, [next, 'start', '--port', String(PORT)], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, NODE_ENV: 'production' },
    });
  }

  await waitUntilUp();
  const appOrigin = await asACrawler();

  if (stub) {
    expect(
      appOrigin === stub.origin,
      `the site sends people to ${appOrigin} for the app, and was built to send them to the stand-in at ${stub.origin}`
    );
    await sharePageAsACrawler({ origin, stub, appOrigin, expect });
  } else {
    await sharePageOfARunningSite({ origin, production, appOrigin, expect });
  }

  await asAVisitor(stub);
} catch (error) {
  problems.push(String(error?.message ?? error));
} finally {
  server?.kill();
  await stub?.close();
}

if (problems.length > 0) {
  console.error(`The site at ${origin} is not right:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('The site is in its HTML, sends its headers, and a browser has no complaint.');
