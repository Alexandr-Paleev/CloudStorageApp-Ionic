/**
 * The nightly reconciliation of hosted storage: what the providers hold
 * against what the `files` rows say (docs/decisions/0018).
 *
 * 0017 made a new row's size the provider's. Three things are still possible,
 * and this is where each is found:
 *
 * - **An object with no row.** An upload signed and never confirmed, a Storage
 *   object put and never recorded, what an account erase left. Nothing counts
 *   it. Removed after a day.
 * - **A row whose size is not its object's.** An object deleted and replaced
 *   at the same path after its row was written. The row is given the object's
 *   size, and the quota trigger moves the counter with it.
 * - **A row with no object.** Reported, never acted on: the file is broken
 *   for its owner, and deleting the row would hide that rather than explain it.
 *
 * Then `profiles.bytes_used` is recounted from the rows.
 *
 * Nothing is removed or changed unless `apply` is set; without it the outcome
 * says what would have been. Everything here works through `ReconcileDeps`,
 * so the rules can be tested without a provider (`reconcile-providers.ts` is
 * the other half).
 */

export type ReconciledProvider = 'cloudinary' | 'r2' | 'supabase_storage';

/** An object as its provider lists it. */
export interface StoredObject {
  path: string;
  size: number;
  createdAt: Date;
  /** Cloudinary keeps images, raw files and videos apart, and deletes by type. */
  resourceType?: string;
}

/** A `files` row, as much of it as the reconciliation reads. */
export interface RecordedRow {
  id: string;
  path: string;
  size: number;
  createdAt: Date;
}

/** A provider the server lists itself: Cloudinary and R2. */
export interface ListedStore {
  /** Everything under the app's own prefix, and nothing else. */
  list(): Promise<StoredObject[]>;
  remove(objects: StoredObject[]): Promise<void>;
}

/** One finding of `reconcile_storage_bucket` (migrations/021). */
export interface BucketFinding {
  kind: 'orphan' | 'misweighed' | 'missing';
  path: string;
  file_id: string | null;
  recorded: number | null;
  actual: number | null;
}

/** One profile whose counter is not the sum of its rows. */
export interface QuotaDrift {
  user_id: string;
  recorded: number;
  counted: number;
}

export interface ReconcileDeps {
  /** Every row of a provider the server lists. */
  rows(provider: 'cloudinary' | 'r2'): Promise<RecordedRow[]>;
  /** Supabase Storage is compared inside the database, in one query. */
  storageBucket(createdBefore: Date): Promise<BucketFinding[]>;
  removeFromBucket(paths: string[]): Promise<void>;
  /** Sets a row's size, if it still says `from`. True when it did. */
  resize(fileId: string, from: number, to: number): Promise<boolean>;
  recount(apply: boolean): Promise<QuotaDrift[]>;
  /** Absent where the deployment has no such provider configured. */
  cloudinary?: ListedStore;
  r2?: ListedStore;
}

export interface ProviderOutcome {
  orphans: number;
  orphanBytes: number;
  removed: number;
  misweighed: number;
  resized: number;
  missing: number;
  /** Why the orphans were left in place although `apply` was set. */
  held?: string;
  failure?: string;
}

export interface ReconcileOutcome {
  applied: boolean;
  providers: Partial<Record<ReconciledProvider, ProviderOutcome>>;
  quota: { drifted: number; corrected: number; failure?: string };
}

/** An upload writes its object first and its row after it. A day is far
 *  longer than that, and longer than a resumable upload is kept alive. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Removed in one night at most, per provider. What is left goes the next. */
export const MAX_REMOVALS = 1000;

/**
 * More orphans than this, and more than half of what a provider holds, and
 * nothing is removed. That many at once is not what uploads leave behind; it
 * is what a reconciliation that misread the rows would see, and removing them
 * would be deleting the files of everyone.
 */
export const HOLD_ABOVE = 20;

const empty = (): ProviderOutcome => ({
  orphans: 0,
  orphanBytes: 0,
  removed: 0,
  misweighed: 0,
  resized: 0,
  missing: 0,
});

/** A provider's error, as text with nothing of the request in it: the
 *  Cloudinary SDK rejects with the request it made (see `configureCloudinary`). */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const nested = (error as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof nested === 'string' ? nested : 'unknown error';
}

function heldBecause(orphans: number, total: number, missing: number): string | undefined {
  if (orphans > HOLD_ABOVE && orphans * 2 > total) {
    return `${orphans} of ${total} objects have no row; not removing that many at once`;
  }
  /* A row is written after its object and deleted with it, so the two sides
     disagreeing at once is what paths read in two different shapes look like:
     every row would be missing its object and every object its row, at any
     count, under the threshold above too. */
  if (orphans > 0 && missing > 0) {
    return `${missing} rows have no object while ${orphans} objects have no row; the paths may be misread`;
  }
  return undefined;
}

async function resizeAll(
  deps: ReconcileDeps,
  changes: { id: string; from: number; to: number }[],
  outcome: ProviderOutcome
): Promise<void> {
  for (const change of changes) {
    if (await deps.resize(change.id, change.from, change.to)) outcome.resized += 1;
  }
}

async function reconcileListed(
  outcome: ProviderOutcome,
  provider: 'cloudinary' | 'r2',
  store: ListedStore,
  deps: ReconcileDeps,
  cutoff: number,
  apply: boolean
): Promise<void> {
  /* The rows first, then the objects. A row is written after its object, so
     every row read here has its object by the time the list is made, and a
     row with no object is one whose object is really gone. The other way
     round, an upload confirmed between the two reads would look like that. */
  const rows = await deps.rows(provider);
  const objects = await store.list();

  const rowAt = new Map(rows.map((row) => [row.path, row]));
  const objectAt = new Map(objects.map((object) => [object.path, object]));

  const orphans = objects.filter(
    (object) => !rowAt.has(object.path) && object.createdAt.getTime() < cutoff
  );
  const changes = rows.flatMap((row) => {
    const object = objectAt.get(row.path);
    return object && object.size !== row.size
      ? [{ id: row.id, from: row.size, to: object.size }]
      : [];
  });

  outcome.orphans = orphans.length;
  outcome.orphanBytes = orphans.reduce((sum, object) => sum + object.size, 0);
  outcome.misweighed = changes.length;
  outcome.missing = rows.filter(
    (row) => !objectAt.has(row.path) && row.createdAt.getTime() < cutoff
  ).length;
  outcome.held = heldBecause(orphans.length, objects.length, outcome.missing);

  if (!apply) return;

  if (!outcome.held && orphans.length > 0) {
    const batch = orphans.slice(0, MAX_REMOVALS);
    await store.remove(batch);
    outcome.removed = batch.length;
  }
  await resizeAll(deps, changes, outcome);
}

async function reconcileBucket(
  outcome: ProviderOutcome,
  deps: ReconcileDeps,
  cutoff: number,
  apply: boolean
): Promise<void> {
  const findings = await deps.storageBucket(new Date(cutoff));

  const orphans = findings.filter((finding) => finding.kind === 'orphan');
  const changes = findings.flatMap((finding) =>
    finding.kind === 'misweighed' &&
    finding.file_id !== null &&
    finding.recorded !== null &&
    finding.actual !== null
      ? [{ id: finding.file_id, from: finding.recorded, to: finding.actual }]
      : []
  );

  outcome.orphans = orphans.length;
  outcome.orphanBytes = orphans.reduce((sum, finding) => sum + (finding.actual ?? 0), 0);
  outcome.misweighed = changes.length;
  outcome.missing = findings.filter((finding) => finding.kind === 'missing').length;

  /* No hold here: the database compares the bucket with the rows in one
     query, and there is no list of rows of ours that could come back short. */
  if (!apply) return;

  if (orphans.length > 0) {
    const batch = orphans.slice(0, MAX_REMOVALS).map((finding) => finding.path);
    await deps.removeFromBucket(batch);
    outcome.removed = batch.length;
  }
  await resizeAll(deps, changes, outcome);
}

/**
 * Each provider on its own: one that fails is reported with its message, and
 * the others still run. The recount goes last, so that it sees the sizes the
 * night has corrected.
 */
export async function reconcile(
  deps: ReconcileDeps,
  options: { now: Date; apply: boolean }
): Promise<ReconcileOutcome> {
  const cutoff = options.now.getTime() - ORPHAN_AGE_MS;
  const outcome: ReconcileOutcome = {
    applied: options.apply,
    providers: {},
    quota: { drifted: 0, corrected: 0 },
  };

  /* Each provider fills an outcome made before it starts: one that fails
     halfway keeps what it had already done, which is the part the owner most
     needs to read. */
  const runs: [ReconciledProvider, (result: ProviderOutcome) => Promise<void>][] = [
    ['supabase_storage', (result) => reconcileBucket(result, deps, cutoff, options.apply)],
  ];
  if (deps.cloudinary) {
    const store = deps.cloudinary;
    runs.push([
      'cloudinary',
      (result) => reconcileListed(result, 'cloudinary', store, deps, cutoff, options.apply),
    ]);
  }
  if (deps.r2) {
    const store = deps.r2;
    runs.push([
      'r2',
      (result) => reconcileListed(result, 'r2', store, deps, cutoff, options.apply),
    ]);
  }

  for (const [provider, run] of runs) {
    const result = empty();
    outcome.providers[provider] = result;
    try {
      await run(result);
    } catch (error) {
      result.failure = messageOf(error);
    }
  }

  try {
    const drift = await deps.recount(options.apply);
    outcome.quota.drifted = drift.length;
    if (options.apply) outcome.quota.corrected = drift.length;
  } catch (error) {
    outcome.quota.failure = messageOf(error);
  }

  return outcome;
}

/**
 * One line for the owner, or null when the night found nothing. What is in it
 * is counts: a path holds an owner's id and a file's name.
 */
export function summarize(outcome: ReconcileOutcome): string | null {
  const parts: string[] = [];
  for (const [provider, result] of Object.entries(outcome.providers)) {
    if (!result) continue;
    if (result.failure) parts.push(`${provider}: failed (${result.failure})`);
    if (result.orphans) {
      parts.push(
        `${provider}: ${result.orphans} objects with no row (${result.orphanBytes} bytes), ${result.removed} removed`
      );
    }
    if (result.held) parts.push(`${provider}: held, ${result.held}`);
    if (result.misweighed) {
      parts.push(`${provider}: ${result.misweighed} rows misweighed, ${result.resized} corrected`);
    }
    if (result.missing) parts.push(`${provider}: ${result.missing} rows with no object`);
  }
  if (outcome.quota.failure) parts.push(`quota: failed (${outcome.quota.failure})`);
  if (outcome.quota.drifted) {
    parts.push(
      `quota: ${outcome.quota.drifted} counters off their rows, ${outcome.quota.corrected} corrected`
    );
  }
  if (parts.length === 0) return null;
  return `Reconciliation${outcome.applied ? '' : ' (dry run)'}: ${parts.join('; ')}`;
}

/** Whether anything in the outcome is a failure rather than a finding. */
export function failed(outcome: ReconcileOutcome): boolean {
  return (
    Boolean(outcome.quota.failure) ||
    Object.values(outcome.providers).some((result) => Boolean(result?.failure))
  );
}
