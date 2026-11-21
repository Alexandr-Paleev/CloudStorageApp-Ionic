import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_NAME_LENGTH, SERVER_RECORDED, STORAGE_TYPES, isServerRecorded } from './file-rules';
import { HOSTED_PROVIDERS } from './stored-path';

/* SQL cannot import a constant, so the migrations write these a second time,
   and this is what notices when the two stop agreeing. */
const migration = (name: string) =>
  readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8');

/** The quoted words of the first SQL list `marker` captures. */
function quotedIn(sql: string, marker: RegExp): string[] {
  const list = marker.exec(sql)?.[1];
  if (list === undefined) throw new Error(`nothing matches ${marker} in the migration`);
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

describe('what a row may say, in the database and in the code', () => {
  const rows = migration('018_constrain_file_rows.sql');

  it('names the same providers', () => {
    expect(quotedIn(rows, /storage_type IN \(([^)]*)\)/)).toEqual([...STORAGE_TYPES]);
  });

  it('allows names of the same length, for files and for folders', () => {
    const limits = [...rows.matchAll(/char_length\(name\) BETWEEN 1 AND (\d+)/g)].map((match) =>
      Number(match[1])
    );
    expect(limits).toEqual([MAX_NAME_LENGTH, MAX_NAME_LENGTH]);
  });
});

describe('the providers the quota counts', () => {
  const quota = migration('007_enforce_storage_quota.sql');

  it('are the hosted ones, in the trigger and in its recount', () => {
    expect(quotedIn(quota, /HOSTED CONSTANT TEXT\[\] := ARRAY\[([^\]]*)\]/)).toEqual([
      ...HOSTED_PROVIDERS,
    ]);
    expect(quotedIn(quota, /storage_type IN \(([^)]*)\)/)).toEqual([...HOSTED_PROVIDERS]);
  });

  it('are providers a row may name', () => {
    for (const hosted of HOSTED_PROVIDERS) expect(STORAGE_TYPES).toContain(hosted);
  });
});

describe('the rows only a server writes', () => {
  const confirmed = migration('020_server_records_hosted_uploads.sql');

  it('are the ones the browser may not insert, in the policy and in the code', () => {
    const browser = quotedIn(confirmed, /storage_type IN \(([^)]*)\)/);
    expect([...browser, ...SERVER_RECORDED].sort()).toEqual([...STORAGE_TYPES].sort());
    for (const provider of SERVER_RECORDED) expect(browser).not.toContain(provider);
  });

  it('are hosted, and every hosted provider is weighed by someone', () => {
    for (const provider of SERVER_RECORDED) expect(HOSTED_PROVIDERS).toContain(provider);
    const weighedByTheDatabase = HOSTED_PROVIDERS.filter((p) => !isServerRecorded(p));
    expect(weighedByTheDatabase).toEqual(['supabase_storage']);
    expect(confirmed).toMatch(/NEW\.storage_type = 'supabase_storage'/);
  });
});
