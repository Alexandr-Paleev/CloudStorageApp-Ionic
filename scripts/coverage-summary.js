/**
 * Renders coverage/coverage-summary.json as two Markdown tables for the
 * GitHub Actions run page.
 *
 * Two, not one: the Vercel handlers and the React layer are covered by
 * separate suites in separate runtimes (see vitest.config.mts), and a single
 * blended percentage would hide which of the two a pull request moved.
 */
const path = require('node:path');
const summary = require('../coverage/coverage-summary.json');

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const GROUPS = [
  ['Server — api/ and lib/', (file) => file.startsWith('api/') || file.startsWith('lib/')],
  ['Client — src/', (file) => file.startsWith('src/')],
];

/* Derived from this file's own location, not from cwd. The keys in the report
   are absolute paths, and stripping the wrong prefix off them does not fail —
   it just matches nothing, and the step would print two tables of 0.00% and
   exit 0. Coverage silently reading zero is worse than no table at all. */
const root = path.resolve(__dirname, '..') + path.sep;

for (const [title, belongs] of GROUPS) {
  const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
  let matched = 0;

  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue;
    const relative = file.startsWith(root) ? file.slice(root.length) : file;
    if (!belongs(relative)) continue;

    matched += 1;
    for (const metric of METRICS) {
      totals[metric].covered += data[metric].covered;
      totals[metric].total += data[metric].total;
    }
  }

  console.log(`### ${title}\n`);

  if (matched === 0) {
    console.log('No files matched. The report is not being read correctly — see the step log.\n');
    console.error(`coverage-summary: no files matched "${title}" under ${root}`);
    process.exitCode = 1;
    continue;
  }

  console.log('| | % | covered |');
  console.log('|---|---|---|');
  for (const metric of METRICS) {
    const { covered, total } = totals[metric];
    const pct = total ? ((covered / total) * 100).toFixed(2) : '0.00';
    console.log(`| ${metric} | ${pct}% | ${covered}/${total} |`);
  }
  console.log('');
}
