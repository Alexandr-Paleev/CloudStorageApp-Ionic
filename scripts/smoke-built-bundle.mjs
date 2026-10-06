#!/usr/bin/env node
/**
 * Opens the built bundle in a real browser and asks two questions: did it
 * render anything at all, and does its service worker keep to the app?
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
 * Usage: node scripts/smoke-built-bundle.mjs [url]
 * Serves dist/ itself unless a URL is given.
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

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
let worker;
try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
  rendered = ((await page.textContent('body')) ?? '').trim();

  // The first question is answered. What this tab logs from here on, while
  // the worker is being asked, is not part of it.
  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  worker = await askWorker().catch((error) => ({
    problem: `The service worker could not be asked: ${error.message.split('\n')[0]}`,
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
console.log(`  console errors: ${errors.length}`);
for (const error of errors.slice(0, 5)) console.log(`    ${error}`);
console.log(
  `  service worker: ${worker.problem ?? [THE_APP, ...NOT_THE_APP].map(whoAnswered).join(', ')}`
);

if (tooEmpty || errors.length > 0) {
  console.error(
    tooEmpty
      ? `\nThe page rendered ${rendered.length} characters. That is a blank screen.`
      : '\nThe page rendered, but the console carries errors.'
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

console.log('\nThe built bundle renders, and its service worker keeps to the app.');
