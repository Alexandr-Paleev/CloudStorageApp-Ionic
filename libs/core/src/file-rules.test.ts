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

describe('the nightly reconciliation (021)', () => {
  const night = migration('021_reconcile_hosted_storage.sql');
  const quotaFunction = (sql: string) =>
    /CREATE OR REPLACE FUNCTION public\.enforce_storage_quota\(\)[\s\S]*?\n\$\$;/.exec(sql)?.[0];

  it('counts the hosted providers, in the trigger it replaces and in its recount', () => {
    const lists = [...night.matchAll(/HOSTED CONSTANT TEXT\[\] := ARRAY\[([^\]]*)\]/g)].map(
      (match) => [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((word) => word[1])
    );
    expect(lists).toEqual([[...HOSTED_PROVIDERS], [...HOSTED_PROVIDERS]]);
  });

  /* 021 writes 007's trigger out again to change one condition. Anything
     else that differs is a change nobody meant. */
  it('keeps the quota trigger 007 wrote, but for refusing on UPDATE', () => {
    const before = quotaFunction(migration('007_enforce_storage_quota.sql'));
    const after = quotaFunction(night)
      ?.replace(/ {4}-- On INSERT only \(021\)\.[\s\S]*?refused\.\n/, '')
      .replace("IF TG_OP = 'INSERT' AND v_delta > 0", 'IF v_delta > 0');

    expect(before).toBeDefined();
    expect(after).toBe(before);
    expect(night).toContain("IF TG_OP = 'INSERT' AND v_delta > 0 AND v_used + v_delta > v_limit");
  });

  it('lets only the service role call what it adds', () => {
    for (const fn of ['reconcile_storage_bucket(TIMESTAMPTZ)', 'reconcile_bytes_used(BOOLEAN)']) {
      expect(night).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`
      );
      expect(night).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`);
    }
  });
});
