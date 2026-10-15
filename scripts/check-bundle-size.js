/**
 * Fails the build when the browser's first download grows past its budget.
 *
 * The numbers below are not aspirations — they are what `npm run build`
 * produces today plus a little headroom. A budget set to a round number nobody
 * measured gets raised the first time it is hit; one set just above the current
 * figure turns "this dependency costs 40 KB" into a red check on the pull
 * request that adds it, which is the only moment anyone is in a position to
 * decide whether it is worth paying.
 *
 * "First load" is defined the way the browser sees it: the entry script, every
 * chunk index.html preloads, and every stylesheet it links — not the whole
 * dist/, most of which is route chunks fetched later, or never.
 *
 * Sizes are gzipped and in kB (1000 bytes), matching Vite's own build output so
 * the two can be compared without arithmetic.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST = path.resolve(__dirname, '..', 'dist');

const BUDGETS = {
  /* 369.6 kB today, Ionic 177.2 of it.

     Raised from 420 to 445 for React 19 and Ionic 9, which cost 22.4 kB gzip
     between them: react-dom 19 is 18.4 of it, and Ionic 9's move onto
     @lit/react the remaining 6.9. Lowered to 385 when the 37 components of
     Ionic that this app never renders left the bundle, which took 68.6 kB
     with them: see the treeshake rule in vite.config.mts. Moved deliberately
     both times, with the figure written down — the check earns its keep by
     making that number appear at the moment someone is in a position to
     decide whether to pay it. */
  firstLoad: 385,

  /* The largest single chunk, which is and should remain Ionic. A new entry
     here means something else grew into framework territory without anyone
     noticing. 177.2 kB today. It was 245.7 with every component of Ionic in
     it, and 241.5 on Ionic 8 before that. */
  largestChunk: 185,

  /* Everything under dist/assets, route chunks included: 461.1 kB today.
     Sentry (48.5) sits here rather than in the first load, and this is what
     would catch it quietly moving back. */
  total: 480,
};

function gzipped(file) {
  return zlib.gzipSync(fs.readFileSync(file)).length;
}

function kB(bytes) {
  return bytes / 1000;
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('No dist/index.html — run `npm run build` first.');
  process.exit(1);
}

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

/* Both the entry <script src> and every <link href> that preloads a chunk or
   pulls a stylesheet. Anything index.html does not mention is, by definition,
   not part of the first load. */
const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1].slice(1));

let firstLoad = 0;
const rows = [];

for (const ref of referenced) {
  const size = gzipped(path.join(DIST, ref));
  firstLoad += size;
  rows.push([path.basename(ref), size]);
}

let total = 0;
let largest = { name: '', size: 0 };

for (const file of fs.readdirSync(path.join(DIST, 'assets'))) {
  const size = gzipped(path.join(DIST, 'assets', file));
  total += size;
  if (file.endsWith('.js') && size > largest.size) largest = { name: file, size };
}

const checks = [
  ['First load (JS + CSS)', kB(firstLoad), BUDGETS.firstLoad],
  [`Largest chunk (${largest.name.replace(/-[^-]+\.js$/, '')})`, kB(largest.size), BUDGETS.largestChunk],
  ['All assets', kB(total), BUDGETS.total],
];

const over = checks.filter(([, measured, budget]) => measured > budget);

console.log('### Bundle size\n');
console.log('| | Measured | Budget | Headroom |');
console.log('| --- | ---: | ---: | ---: |');
for (const [label, measured, budget] of checks) {
  const headroom = budget - measured;
  const mark = headroom < 0 ? '🔴' : headroom < budget * 0.02 ? '🟡' : '🟢';
  console.log(
    `| ${mark} ${label} | ${measured.toFixed(1)} kB | ${budget} kB | ${headroom.toFixed(1)} kB |`
  );
}

console.log('\n<details><summary>What the browser fetches first</summary>\n');
console.log('| Chunk | gzip |');
console.log('| --- | ---: |');
for (const [name, size] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`| \`${name}\` | ${kB(size).toFixed(1)} kB |`);
}
console.log('\n</details>');

if (over.length > 0) {
  console.error(
    `\nOver budget: ${over
      .map(([label, measured, budget]) => `${label} by ${(measured - budget).toFixed(1)} kB`)
      .join(', ')}.\n` +
      'Either make it smaller, or raise the budget in scripts/check-bundle-size.js and say why in the commit.'
  );
  process.exit(1);
}
