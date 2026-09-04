#!/usr/bin/env node
/**
 * Fails the build on a high-severity vulnerability in a production dependency —
 * and does not fail it because npmjs.com was having a bad afternoon.
 *
 * `npm audit --audit-level=high` cannot tell those two apart. It exits 1 when
 * it finds something, and it exits 1 when the audit endpoint answers 503, which
 * it did twice in one day here. A required check that turns red on someone
 * else's uptime gets re-run without being read, and a check nobody reads is the
 * same as no check.
 *
 * So: ask for JSON and look at what came back. A report is a verdict — count
 * what is at or above the threshold and answer accordingly. An error object is
 * not a verdict at all; retry it, and if the registry is still unreachable say
 * so loudly and let the build through, because "could not check" is not
 * "vulnerable" and pretending otherwise is what trains people to ignore this
 * step.
 *
 * --omit=dev on purpose, unchanged: a vulnerability in a build tool is not a
 * vulnerability in what the browser downloads or what the functions run.
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** Fail at this severity and above. */
const FAIL_AT = ['high', 'critical'];

/** Waits between attempts. Three tries over ~20s — long enough for a blip,
 *  short enough that a real outage does not hold the job open. */
const BACKOFF_MS = [5_000, 15_000];

/**
 * One `npm audit` run, classified.
 *
 * Returns a report when the registry answered, `null` when it did not — which
 * covers the 503, a DNS failure, and output that is not JSON at all.
 */
function attemptAudit() {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  /* A report always carries the counts. An outage answers with { error: … },
     and npm's own exit code is 1 in both cases, which is the whole problem. */
  return parsed?.metadata?.vulnerabilities ? parsed : null;
}

function describeFailure(report) {
  const counts = report.metadata.vulnerabilities;
  const failing = FAIL_AT.filter((level) => counts[level] > 0);

  if (failing.length === 0) return null;

  const named = Object.entries(report.vulnerabilities ?? {})
    .filter(([, v]) => FAIL_AT.includes(v.severity))
    .map(([name, v]) => `  ${v.severity.padEnd(8)} ${name}`);

  return [
    `${failing.map((l) => `${counts[l]} ${l}`).join(', ')} in production dependencies:`,
    ...named,
  ].join('\n');
}

let report = null;
for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
  report = attemptAudit();
  if (report) break;

  const wait = BACKOFF_MS[attempt];
  if (wait === undefined) break;
  console.log(`The audit endpoint did not answer. Retrying in ${wait / 1000}s…`);
  await sleep(wait);
}

if (!report) {
  console.log('');
  console.log('⚠️  Could not reach the npm audit endpoint after 3 attempts.');
  console.log('    Production dependencies were NOT audited on this run.');
  console.log('    Not failing the build: an unreachable registry is not a vulnerability.');
  process.exit(0);
}

const failure = describeFailure(report);
const counts = report.metadata.vulnerabilities;

console.log(
  `Audited ${report.metadata.dependencies?.prod ?? '?'} production dependencies — ` +
    `${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low.`
);

if (failure) {
  console.error('');
  console.error(failure);
  process.exit(1);
}
