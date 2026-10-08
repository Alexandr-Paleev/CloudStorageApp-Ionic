#!/usr/bin/env node
/**
 * Prints a hash of the env files at the repository root, for Nx.
 *
 * Nx decides whether a cached result still stands by hashing what the task
 * read, and it does not count a file that git ignores. `.env` is ignored, and
 * it is an input all the same. Vite inlines every VITE_ variable into the
 * bundle, a native shell is pinned to whatever VITE_API_ORIGIN said on the
 * day it was built, and the tests load the same files. Without this, a build
 * made before an edit to `.env` would be handed back after it.
 *
 * nx.json lists this script as a runtime input, which makes its output part
 * of every cache key. Only the digest is printed, never a value.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const hash = createHash('sha256');

const envFiles = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
  .map((entry) => entry.name)
  .sort();

for (const name of envFiles) {
  hash
    .update(name)
    .update('\0')
    .update(readFileSync(new URL(name, root)))
    .update('\0');
}

console.log(hash.digest('hex'));
