#!/usr/bin/env node
/**
 * Asks Nx what this push changes, and tells the workflow.
 *
 * Until this existed, every push ran everything. The pull request that added
 * decision 0014 changed two markdown files, and for them CI built the app,
 * ran Lighthouse and put the whole end-to-end suite through the live
 * database: 43 tests, 30 accounts opened and removed.
 *
 * There are two answers, because there are two things to check.
 *
 * The app is the root project with api/, libs/core and libs/server: one lint,
 * one test run and one end-to-end suite cover all four. The site is apps/web.
 * A change to the site runs the site's steps and leaves the app's alone, and
 * the other way round. What both read, libs/core and the lock file among it,
 * runs both.
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
 * Writes AFFECTED_APP and AFFECTED_WEB, each true or false, to $GITHUB_ENV
 * when there is one.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const { GITHUB_REF, GITHUB_ENV, GITHUB_STEP_SUMMARY } = process.env;
const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);

/**
 * The one project that is not the app. Any other name Nx gives is checked
 * with the app, so a project added later is covered before anyone decides
 * where it belongs.
 */
const SITE = 'web';

function decide() {
  if (GITHUB_REF === 'refs/heads/main') {
    return { app: true, web: true, why: 'A push to main runs everything.' };
  }

  const answer = execFileSync(
    'npx',
    ['nx', 'show', 'projects', '--affected', `--base=${base}`, `--head=${head}`, '--json'],
    { encoding: 'utf8' }
  );
  const projects = JSON.parse(answer);
  if (!Array.isArray(projects)) throw new Error(`Nx answered with something else: ${answer}`);

  if (projects.length === 0) {
    return {
      app: false,
      web: false,
      why: `Nx finds no project affected between ${base} and ${head}: what this push changes is listed in .nxignore, or it changes nothing. The remaining steps are skipped.`,
    };
  }

  const web = projects.includes(SITE);
  const app = projects.some((project) => project !== SITE);
  const verdict =
    app && web
      ? "The app's steps and the site's both run."
      : app
        ? "The app's steps run, and the site's are skipped."
        : "The site's steps run, and the app's are skipped.";

  return { app, web, why: `This change touches ${projects.join(', ')}. ${verdict}` };
}

const { app, web, why } = decide();
console.log(why);

if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `AFFECTED_APP=${app}\nAFFECTED_WEB=${web}\n`);
if (GITHUB_STEP_SUMMARY && !(app && web)) appendFileSync(GITHUB_STEP_SUMMARY, `${why}\n`);
