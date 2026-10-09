#!/usr/bin/env node
/**
 * Asks Nx whether this push changes any project, and tells the workflow.
 *
 * Until this existed, every push ran everything. The pull request that added
 * decision 0014 changed two markdown files, and for them CI built the app,
 * ran Lighthouse and put the whole end-to-end suite through the live
 * database: 43 tests, 30 accounts opened and removed.
 *
 * What belongs to no project is listed in .nxignore, and it is documentation
 * only. Nx leaves those files out of every project, so a push that touches
 * nothing else affects none of them and the steps after this one are skipped.
 * The jobs still end green, which is what the required checks need.
 *
 * A push to main is not asked. It runs everything, so that a mistake in what
 * Nx is told cannot hide behind a skipped check for long.
 *
 * If Nx cannot answer, this fails. A job that skipped its work because the
 * question went wrong would look exactly like one that had nothing to do.
 *
 * Usage: node scripts/ci-affected.mjs [base] [head]
 * Writes AFFECTED=true or AFFECTED=false to $GITHUB_ENV when there is one.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const { GITHUB_REF, GITHUB_ENV, GITHUB_STEP_SUMMARY } = process.env;
const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);

function decide() {
  if (GITHUB_REF === 'refs/heads/main') {
    return { affected: true, why: 'A push to main runs everything.' };
  }

  const answer = execFileSync(
    'npx',
    ['nx', 'show', 'projects', '--affected', `--base=${base}`, `--head=${head}`, '--json'],
    { encoding: 'utf8' }
  );
  const projects = JSON.parse(answer);
  if (!Array.isArray(projects)) throw new Error(`Nx answered with something else: ${answer}`);

  return projects.length > 0
    ? { affected: true, why: `This change touches ${projects.join(', ')}.` }
    : {
        affected: false,
        why: `Nx finds no project affected between ${base} and ${head}: what this push changes is listed in .nxignore, or it changes nothing. The remaining steps are skipped.`,
      };
}

const { affected, why } = decide();
console.log(why);

if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `AFFECTED=${affected}\n`);
if (GITHUB_STEP_SUMMARY && !affected) appendFileSync(GITHUB_STEP_SUMMARY, `${why}\n`);
