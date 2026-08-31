/**
 * Renders coverage/coverage-summary.json as two Markdown tables for the
 * GitHub Actions run page.
 *
 * Two, not one: the Vercel handlers and the React layer are covered by
 * separate suites in separate runtimes (see vitest.config.mts), and a single
 * blended percentage would hide which of the two a pull request moved.
 */
const summary = require('../coverage/coverage-summary.json');

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const GROUPS = [
  ['Server — api/ and lib/', (path) => path.startsWith('api/') || path.startsWith('lib/')],
  ['Client — src/', (path) => path.startsWith('src/')],
];

const root = `${process.cwd()}/`;

for (const [title, belongs] of GROUPS) {
  const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));

  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue;
    const relative = file.startsWith(root) ? file.slice(root.length) : file;
    if (!belongs(relative)) continue;

    for (const metric of METRICS) {
      totals[metric].covered += data[metric].covered;
      totals[metric].total += data[metric].total;
    }
  }

  console.log(`### ${title}\n`);
  console.log('| | % | covered |');
  console.log('|---|---|---|');
  for (const metric of METRICS) {
    const { covered, total } = totals[metric];
    const pct = total ? ((covered / total) * 100).toFixed(2) : '0.00';
    console.log(`| ${metric} | ${pct}% | ${covered}/${total} |`);
  }
  console.log('');
}
