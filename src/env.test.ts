import { describe, expect, it } from 'vitest';
import source from './env.ts?raw';

/**
 * env.ts reads each variable by its name and hands the schema a list of
 * them. The type on that list makes it carry every key of the schema and no
 * other. It says nothing about which variable a line reads, and a line that
 * reads its neighbour's would compile, pass every other test, and switch a
 * feature on or off in production by the wrong flag.
 *
 * This reads the file as text for that reason: the mistake is in how a line
 * is spelled, and nothing that runs the module can see it. `?raw` is how
 * Vite hands over a file's text. Under jsdom a test file's own address is
 * not a `file:` one, so `node:fs` has no path to open from here.
 */
describe('the list of variables env.ts hands to its schema', () => {
  const start = source.indexOf('const given');
  const lines = source
    .slice(source.indexOf('{', start) + 1, source.indexOf('};', start))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  it('reads, on every line, the variable that line is named for', () => {
    /* An empty list would pass the check below, and would mean the list has
       moved or been renamed and this test is looking at nothing. */
    expect(start).toBeGreaterThan(-1);
    expect(lines.length).toBeGreaterThan(0);

    const misread = lines.filter(
      (line) => !/^(VITE_[A-Z0-9_]+): import\.meta\.env\.\1,$/.test(line)
    );
    expect(misread).toEqual([]);
  });
});
