/**
 * Renders coverage/coverage-summary.json as two Markdown tables for the
 * GitHub Actions run page, and — with `--badges <dir>` — as the two JSON files
 * shields.io reads to draw the badges in the README.
 *
 * Two, not one, in both forms: the Vercel handlers and the React layer are
 * covered by separate suites in separate runtimes (see vitest.config.mts), and
 * a single blended percentage would hide which of the two a pull request moved.
 * A single badge would do the same thing to a reader who never opens the run —
 * and it would flatter the number, since the server half is the half that
 * decides access, money and quota.
 */
const fs = require('node:fs');
const path = require('node:path');
const summary = require('../coverage/coverage-summary.json');

/** `--badges <dir>` writes the shields.io endpoints instead of the tables. */
const badgeDirIndex = process.argv.indexOf('--badges');
const badgeDir = badgeDirIndex === -1 ? null : process.argv[badgeDirIndex + 1];
if (badgeDirIndex !== -1 && !badgeDir) {
  console.error('coverage-summary: --badges needs a directory');
  process.exit(1);
}

/* shields.io's own scale, so the colour means what it means on every other
   badge a reader has seen. */
function colourFor(pct) {
  if (pct >= 90) return 'brightgreen';
  if (pct >= 80) return 'green';
  if (pct >= 70) return 'yellowgreen';
  if (pct >= 60) return 'yellow';
  if (pct >= 50) return 'orange';
  return 'red';
}

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const GROUPS = [
  ['Server — api/ and lib/', 'server', (file) => file.startsWith('api/') || file.startsWith('lib/')],
  ['Client — src/', 'client', (file) => file.startsWith('src/')],
];

/* Derived from this file's own location, not from cwd. The keys in the report
   are absolute paths, and stripping the wrong prefix off them does not fail —
   it just matches nothing, and the step would print two tables of 0.00% and
   exit 0. Coverage silently reading zero is worse than no table at all. */
const root = path.resolve(__dirname, '..') + path.sep;

for (const [title, slug, belongs] of GROUPS) {
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

  if (matched === 0) {
    /* Not a warning. The report keys are absolute paths, and stripping the
       wrong prefix matches nothing and reads as 0.00% — a badge that says zero
       is worse than no badge, because it looks like an answer. */
    console.error(`coverage-summary: no files matched "${title}" under ${root}`);
    if (!badgeDir) {
      console.log(`### ${title}\n`);
      console.log('No files matched. The report is not being read correctly — see the step log.\n');
    }
    process.exitCode = 1;
    continue;
  }

  if (badgeDir) {
    /* Statements, because it is the line the rest of this project quotes, and a
       badge that measured something different from the tables underneath it
       would invite exactly one question and answer it wrongly. */
    const { covered, total } = totals.statements;
    const pct = total ? (covered / total) * 100 : 0;

    fs.mkdirSync(badgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(badgeDir, `coverage-${slug}.json`),
      JSON.stringify({
        schemaVersion: 1,
        label: `coverage ${slug}`,
        message: `${pct.toFixed(1)}%`,
        color: colourFor(pct),
      }) + '\n'
    );
    continue;
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
