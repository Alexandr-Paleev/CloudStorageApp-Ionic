import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

/**
 * Only the functions may import `libs/server`. That is a lint rule, and a
 * lint rule can stop working without anything turning red: the one that keeps
 * the projects apart reads a graph from disk, and when the graph is missing
 * it checks nothing and ESLint exits 0.
 *
 * So this asks two questions that do not depend on each other.
 *
 * What does lint say about an import? The real config is given a file that
 * does not exist and one line of code for it. A rule that has been switched
 * off, or has lost its graph, answers "nothing" to all of them, and every
 * case below that expects a refusal fails.
 *
 * And what does the code import today? Nx reads every source file and draws
 * the graph. A disable comment silences the rule for one line; it does not
 * take the import out of the graph.
 */

/* Nx keeps its graph in .nx/workspace-data, and reads where that is once,
   when it is loaded. Pointed somewhere empty first, both questions start from
   nothing, the way a fresh checkout does, and this file leaves the
   repository's own copy alone. Nothing above this line loads Nx: ESLint does
   when it reads the config, and the last test does by hand. */
const NX_DATA = 'NX_WORKSPACE_DATA_DIRECTORY';
const before = process.env[NX_DATA];
const scratch = mkdtempSync(join(tmpdir(), 'boundaries-'));
process.env[NX_DATA] = scratch;

const root = fileURLToPath(new URL('..', import.meta.url));

/** The rule's own name for "a relative path that leaves its project". */
const ACROSS = ['noRelativeOrAbsoluteImportsAcrossLibraries'];
const NOTHING: string[] = [];

let eslint: ESLint;

/** Everything ESLint says about `code` if it were the file at `file`. */
async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\n`, { filePath: join(root, file) });
  /* No result means ESLint skipped the file, and a skipped file must not read as clean. */
  if (!result) throw new Error(`ESLint did not lint ${file}`);
  return result.messages.map((message) => message.messageId ?? message.message);
}

beforeAll(async () => {
  eslint = new ESLint({ cwd: root });
  /* The first file pays for loading the config, which draws the graph. */
  await lint('src/probe.ts', 'export const probe = 1;');
}, 60_000);

afterAll(() => {
  if (before === undefined) delete process.env[NX_DATA];
  else process.env[NX_DATA] = before;
  rmSync(scratch, { recursive: true, force: true });
});

describe('what lint says about an import', () => {
  it.each([
    [
      'the app reaches libs/core by its name',
      'src/probe.ts',
      "export { TIER_LIMITS } from '@cloud-storage/core/tiers';",
      NOTHING,
    ],
    [
      'and not by its path',
      'src/probe.ts',
      "export { TIER_LIMITS } from '../libs/core/src/tiers';",
      ACROSS,
    ],
    [
      'the app does not reach libs/server',
      'src/probe.ts',
      "export { authenticateUser } from '../libs/server/src/auth';",
      ACROSS,
    ],
    [
      'not for a type',
      'src/probe.ts',
      "export type { AuthenticatedUser } from '../libs/server/src/auth';",
      ACROSS,
    ],
    [
      'not with import()',
      'src/probe.ts',
      "export const load = () => import('../libs/server/src/auth');",
      ACROSS,
    ],
    [
      'not from a page',
      'src/pages/Probe.tsx',
      "export { authenticateUser } from '../../libs/server/src/auth';",
      ACROSS,
    ],
    [
      'and neither does an end-to-end spec',
      'e2e/probe.spec.ts',
      "export { authenticateUser } from '../libs/server/src/auth';",
      ACROSS,
    ],
    [
      'libs/core does not reach libs/server',
      'libs/core/src/probe.ts',
      "export { authenticateUser } from '../../server/src/auth';",
      ACROSS,
    ],
    [
      'libs/server reaches libs/core by path',
      'libs/server/src/probe.ts',
      "export { TIER_LIMITS } from '../../core/src/tiers';",
      NOTHING,
    ],
    [
      'libs/server does not reach the app',
      'libs/server/src/probe.ts',
      "export { env } from '../../../src/env';",
      ACROSS,
    ],
    [
      'a function reaches both libraries by path',
      'api/probe.ts',
      "export { authenticateUser } from '../libs/server/src/auth';\nexport { TIER_LIMITS } from '../libs/core/src/tiers';",
      NOTHING,
    ],
    [
      'a function a folder down does too',
      'api/r2/probe.ts',
      "export { authenticateUser } from '../../libs/server/src/auth';",
      NOTHING,
    ],
    [
      'a function does not reach the app',
      'api/probe.ts',
      "export { env } from '../src/env';",
      ACROSS,
    ],
  ])('%s', async (_claim, file, code, expected) => {
    expect(await lint(file, code)).toEqual(expected);
  });
});

describe('what the code imports today', () => {
  it('is the graph decision 0014 draws', async () => {
    const { createProjectGraphAsync } = await import('nx/src/devkit-exports.js');
    const graph = await createProjectGraphAsync();
    const projects = Object.keys(graph.nodes);
    const edges = Object.fromEntries(
      projects.map((project) => [
        project,
        [
          ...new Set(
            (graph.dependencies[project] ?? [])
              .map((dependency) => dependency.target)
              .filter((target) => projects.includes(target))
          ),
        ].sort(),
      ])
    );

    expect(edges).toEqual({
      'cloud-storage-app': ['core'],
      api: ['core', 'server'],
      server: ['core'],
      core: [],
    });
  }, 60_000);
});
