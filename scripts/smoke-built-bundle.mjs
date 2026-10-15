#!/usr/bin/env node
/**
 * Opens the built bundle in a real browser and asks three questions: did it
 * render anything at all, does its service worker keep to the app, and is a
 * collector told a secret that is in the address?
 *
 * Everything else in this repository tests the source. `npm run dev` serves
 * unbundled modules, so `manualChunks` in vite.config.mts is inert there, and
 * the Playwright suite runs against that dev server — which means the chunk
 * split, the one piece of configuration that can turn a working app into a
 * blank page, was never executed by any check.
 *
 * It did exactly that: react-dom sat in one chunk and React in another, and
 * the order held only by luck until an unrelated dependency changed the
 * contents of `vendor`. Lint, 621 unit tests, the e2e suite and the bundle
 * budgets were all green on a build that painted nothing.
 *
 * The service worker is out of sight for the same reason. The one production
 * registers exists only in the build. The dev server generates its own, which
 * falls back to the app shell for `/` and for nothing else, while the built
 * one answers every navigation in its scope with the cached index.html unless
 * it is told otherwise. It had not been told about /api/, or about files it
 * does not precache: a browser sent to either was shown the app's "not found"
 * page instead of what the server would have said.
 *
 * The third question is here for a reason of its own. Analytics start only in
 * a production build, so the dev server, and every test that runs against
 * it, starts none. What they are sent can be seen in the build and nowhere
 * else: `ask-the-collectors.mjs` says what is asked, and what it found.
 *
 * Alongside the first question, one more: is every Ionic component the source
 * renders registered in the built app? vite.config.mts tells the bundler that
 * Ionic's component modules have no side effects, so the ones nothing imports
 * are left out. That holds for Ionic as it is, and Ionic does not promise it.
 * An upgrade that registered a component somewhere the bundler cannot see
 * would leave that component out, and it would draw nothing on the pages
 * this check never opens. The end-to-end suite would not notice either: the
 * dev server bundles nothing. One page is enough to ask, because a wrapper
 * registers its element when it is created, and every wrapper is created
 * when the app starts.
 *
 * Asked about too: the elements those components need and nobody renders by
 * name, the backdrop behind a dialog, the popover a select opens. Ionic lists
 * them in each component's own code, and they are read from there. Ionic has
 * shipped exactly this fault itself: in 2021 a popover's backdrop was left out
 * of production builds (ionic-team/ionic-framework#24129).
 *
 * Usage: node scripts/smoke-built-bundle.mjs [url]
 * Serves dist/ itself unless a URL is given.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { askTheCollectors } from './ask-the-collectors.mjs';

const PORT = 4173;
const url = process.argv[2];
const target = url ?? `http://localhost:${PORT}/`;

/** Anything under this and the page is a white screen, whatever the status code. */
const MIN_RENDERED_CHARS = 50;

/**
 * How long a page that has just loaded gets to install and activate its
 * service worker. Against dist/ on this machine that takes milliseconds. A
 * real deployment has the whole precache to fetch first: about two seconds
 * against production as a rule, and once more than fifteen. A generous limit
 * costs nothing when the worker does arrive, because the wait ends when it
 * does.
 */
const WORKER_ACTIVATION_MS = 60_000;

/** A route of the app. The worker must answer it, or its silence elsewhere proves nothing. */
const THE_APP = '/dashboard';

/**
 * Navigations the worker must leave to the network. None of these addresses
 * has to exist: the question is who answers, not what the answer is. Both
 * files are made up on purpose. The real one outside the precache is a PDF,
 * and a headless browser downloads a PDF instead of navigating to it. The
 * image is here because the worker has a cache for images, which comes after
 * the fallback and must not pick up a navigation the fallback has let go.
 */
const NOT_THE_APP = ['/api/smoke', '/smoke.txt', '/smoke.png'];

/** Rendered by @ionic/react as a div of its own, so there is nothing to register. */
const NOT_ELEMENTS = new Set(['ion-page']);

/** The Ionic components the app's source renders, as the elements they register. */
function ionicElementsInSource() {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const tags = new Set();
  for (const file of readdirSync(src, { recursive: true })) {
    if (!file.endsWith('.tsx') || file.endsWith('.test.tsx')) continue;
    if (file.split(/[\\/]/)[0] === 'test') continue;
    for (const [, name] of readFileSync(src + file, 'utf8').matchAll(/<Ion([A-Z][A-Za-z]*)/g)) {
      const tag = `ion-${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
      if (!NOT_ELEMENTS.has(tag)) tags.add(tag);
    }
  }
  return [...tags].sort();
}

const IONIC_COMPONENTS = join(
  dirname(createRequire(import.meta.url).resolve('@ionic/core/package.json')),
  'components'
);

/**
 * The elements `tag` registers along with itself, as Ionic's own code lists
 * them: each component's registration walks a list that starts with the
 * component and names everything it renders. A component that other
 * components use keeps that code in a shared module, which its own file
 * imports, so both are read. The list is matched as Ionic ships it, minified
 * and with no spaces; written any other way it is not found, and the smoke
 * test stops and says so.
 */
function dependenciesOf(tag) {
  const own = readFileSync(join(IONIC_COMPONENTS, `${tag}.js`), 'utf8');
  const shared = [...own.matchAll(/from\s*["']\.\/(p-[\w-]+\.js)["']/g)].map(([, file]) =>
    readFileSync(join(IONIC_COMPONENTS, file), 'utf8')
  );
  for (const code of [own, ...shared]) {
    for (const [, list] of code.matchAll(
      /\[("ion-[a-z0-9-]+"(?:,"ion-[a-z0-9-]+")*)\]\.forEach/g
    )) {
      const tags = list.split(',').map((name) => name.slice(1, -1));
      if (tags[0] === tag) return tags;
    }
  }
  return null;
}

/** The source's elements and everything they need, or the tags whose needs could not be read. */
function ionicElementsNeeded(rendered) {
  const needed = new Set();
  const unreadable = [];
  const pending = [...rendered];
  while (pending.length > 0) {
    const tag = pending.pop();
    if (needed.has(tag)) continue;
    needed.add(tag);
    const dependencies = dependenciesOf(tag);
    if (dependencies === null) unreadable.push(tag);
    else pending.push(...dependencies);
  }
  return { needed: [...needed].sort(), unreadable };
}

const ionicElements = ionicElementsInSource();
const ionic = ionicElementsNeeded(ionicElements);
if (ionic.unreadable.length > 0) {
  console.error(
    `Could not read from @ionic/core what ${ionic.unreadable.join(', ')} register along with themselves.\n` +
      'The way Ionic writes its components has changed. Before the treeshake rule in vite.config.mts\n' +
      'is trusted again, find out how they register now.'
  );
  process.exit(1);
}

let preview;
if (!url) {
  preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore' });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await fetch(target);
      break;
    } catch {
      if (Date.now() > deadline) {
        preview.kill();
        console.error(`Preview server did not start on port ${PORT}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const browser = await chromium.launch();
// One context for both tabs: a service worker belongs to the context that
// registered it, and the second tab is there to ask that worker.
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
const onConsole = (message) => message.type() === 'error' && errors.push(message.text());
const onPageError = (error) => errors.push(error.message);
page.on('console', onConsole);
page.on('pageerror', onPageError);

/**
 * Asks the service worker this page registered which navigations it answers
 * itself, or says why it could not be asked.
 */
async function askWorker() {
  const state = await page.evaluate((ms) => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    return Promise.race([
      navigator.serviceWorker.ready.then(() => 'active'),
      new Promise((resolve) => setTimeout(() => resolve('inactive'), ms)),
    ]);
  }, WORKER_ACTIVATION_MS);

  if (state === 'unsupported') {
    return { problem: 'This origin has no service workers: they need https or localhost.' };
  }
  if (state === 'inactive') {
    return {
      problem: `No service worker became active within ${WORKER_ACTIVATION_MS / 1000} seconds.`,
    };
  }

  // In a second tab, so the first one is left as it rendered.
  const probe = await context.newPage();
  const answered = [];
  for (const path of [THE_APP, ...NOT_THE_APP]) {
    const response = await probe.goto(new URL(path, target).href, { waitUntil: 'commit' });
    if (response?.fromServiceWorker()) answered.push(path);
  }
  return { answered };
}

let rendered = '';
let unregistered = [];
let worker;
let collectors;
try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
  rendered = ((await page.textContent('body')) ?? '').trim();
  unregistered = await page.evaluate(
    (tags) => tags.filter((tag) => !customElements.get(tag)),
    ionic.needed
  );

  // The first question is answered. What this tab logs from here on, while
  // the worker is being asked, is not part of it.
  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  worker = await askWorker().catch((error) => ({
    problem: `The service worker could not be asked: ${error.message.split('\n')[0]}`,
  }));

  // In browsers of their own, each one new to the app: what a collector is
  // sent depends on the address the app was opened at.
  collectors = await askTheCollectors(browser, target).catch((error) => ({
    configured: true,
    problems: [`The collectors could not be asked: ${error.message.split('\n')[0]}`],
    said: 'could not be asked',
  }));
} finally {
  await browser.close();
  preview?.kill();
}

const tooEmpty = rendered.length < MIN_RENDERED_CHARS;
const whoAnswered = (path) =>
  `${path} ${worker.answered.includes(path) ? 'answered by the worker' : 'left to the network'}`;

console.log(`Smoke test of the built bundle — ${target}`);
console.log(`  rendered: ${rendered.length} characters`);
console.log(
  `  ionic: ${ionicElements.length} elements the source renders, ${ionic.needed.length} with what they need, ${
    unregistered.length === 0 ? 'all registered' : `not registered: ${unregistered.join(', ')}`
  }`
);
console.log(`  console errors: ${errors.length}`);
for (const error of errors.slice(0, 5)) console.log(`    ${error}`);
console.log(
  `  service worker: ${worker.problem ?? [THE_APP, ...NOT_THE_APP].map(whoAnswered).join(', ')}`
);
console.log(`  collectors: ${collectors.said}`);

if (tooEmpty || errors.length > 0) {
  console.error(
    tooEmpty
      ? `\nThe page rendered ${rendered.length} characters. That is a blank screen.`
      : '\nThe page rendered, but the console carries errors.'
  );
  process.exit(1);
}

if (unregistered.length > 0) {
  console.error(
    `\nThe app needs ${unregistered.join(', ')}, and nothing in the built app registered ${
      unregistered.length === 1 ? 'it, so it draws' : 'them, so they draw'
    } nothing.\n` +
      'The likeliest cause is the treeshake rule in vite.config.mts, after an upgrade of Ionic\n' +
      'moved a registration where the bundler cannot see it. Find where it is, or narrow the rule.'
  );
  process.exit(1);
}

if (worker.problem) {
  console.error(`\n${worker.problem}`);
  process.exit(1);
}

if (!worker.answered.includes(THE_APP)) {
  console.error(
    `\nThe service worker did not answer a navigation to ${THE_APP}, so its silence elsewhere proves nothing.`
  );
  process.exit(1);
}

const overreach = NOT_THE_APP.filter((path) => worker.answered.includes(path));
if (overreach.length > 0) {
  console.error(
    `\nThe service worker answered a navigation to ${overreach.join(', ')}. That is not the app.\n` +
      'In vite.config.mts, navigateFallbackDenylist keeps the fallback out of such addresses,\n' +
      'and the image cache must not take navigations.'
  );
  process.exit(1);
}

if (collectors.problems.length > 0) {
  console.error(`\n${collectors.problems.join('\n')}`);
  process.exit(1);
}

console.log(
  collectors.configured
    ? '\nThe built bundle renders with every Ionic component it uses, its service worker keeps to the app, and no collector is told a secret.'
    : '\nThe built bundle renders with every Ionic component it uses, and its service worker keeps to the app.'
);
