#!/usr/bin/env node
/**
 * Opens the built bundle in a real browser and asks one question: did it
 * render anything at all?
 *
 * Everything else in this repository tests the source. `npm run dev` serves
 * unbundled modules, so `manualChunks` in vite.config.ts is inert there, and
 * the Playwright suite runs against that dev server — which means the chunk
 * split, the one piece of configuration that can turn a working app into a
 * blank page, was never executed by any check.
 *
 * It did exactly that: react-dom sat in one chunk and React in another, and
 * the order held only by luck until an unrelated dependency changed the
 * contents of `vendor`. Lint, 621 unit tests, the e2e suite and the bundle
 * budgets were all green on a build that painted nothing.
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
const page = await browser.newPage();

const errors = [];
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
page.on('pageerror', (error) => errors.push(error.message));

let rendered = '';
try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
  rendered = ((await page.textContent('body')) ?? '').trim();
} finally {
  await browser.close();
  preview?.kill();
}

const tooEmpty = rendered.length < MIN_RENDERED_CHARS;

console.log(`Smoke test of the built bundle — ${target}`);
console.log(`  rendered: ${rendered.length} characters`);
console.log(`  console errors: ${errors.length}`);
for (const error of errors.slice(0, 5)) console.log(`    ${error}`);

if (tooEmpty || errors.length > 0) {
  console.error(
    tooEmpty
      ? `\nThe page rendered ${rendered.length} characters. That is a blank screen.`
      : '\nThe page rendered, but the console carries errors.'
  );
  process.exit(1);
}

console.log('\nThe built bundle renders.');
